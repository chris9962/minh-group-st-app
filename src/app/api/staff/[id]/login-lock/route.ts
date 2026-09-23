import { eq } from "drizzle-orm";
import { logAudit } from "@/server/audit";
import { getActor, unauthorized } from "@/server/auth";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { clearLoginLock, staffTargetFor } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

/**
 * C-01 · Khoá đăng nhập 15 phút sau 5 lần sai mật khẩu, đọc và mở trên hồ sơ
 * nhân viên P-52.
 *
 * Tách khỏi `StaffAccount`: mốc khoá đổi theo từng lần đăng nhập sai, còn hồ sơ
 * tài khoản chỉ đổi khi có người sửa. Gộp chung thì mỗi lần kiểm khoá phải tải
 * lại cả hồ sơ lẫn bảng quyền.
 */

/** `lockedUntil` rỗng = không bị khoá, kể cả khi mốc cũ còn nằm trong DB mà đã qua. */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const target = await staffTargetFor(actor, id, "update");
  if (!target.ok) return target.response;

  const [row] = await db
    .select({ lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.id, target.staff.id))
    .limit(1);

  const until = row?.lockedUntil;
  return Response.json({
    lockedUntil: until && until.getTime() > Date.now() ? until.toISOString() : "",
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const target = await staffTargetFor(actor, id, "update");
  if (!target.ok) return target.response;

  await clearLoginLock(target.staff.id);

  await logAudit(actor, {
    module: "staff",
    action: "update",
    targetLabel: `Mở khoá đăng nhập cho ${target.staff.fullName}`,
    targetTable: "users",
    targetId: target.staff.id,
  });
  return Response.json({ lockedUntil: "" });
}

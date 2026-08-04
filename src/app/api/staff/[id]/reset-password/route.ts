import { logAudit } from "@/server/audit";
import { badRequest, getActor, unauthorized } from "@/server/auth";
import { resetPassword, staffTargetFor } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

/** C-02 · Sinh mật khẩu MỚI, hiện đúng một lần — mật khẩu cũ không đọc lại được. */
export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const target = await staffTargetFor(actor, id, "update");
  if (!target.ok) return target.response;

  // Đặt lại mật khẩu xoá mọi phiên của người đó — làm với chính mình là mất
  // phiên ngay giữa chừng, mật khẩu mới hiện trong hộp thoại đã hết hiệu lực.
  // So id lấy từ DB: uuid của Postgres không phân biệt hoa thường (xem active/route.ts).
  if (target.staff.id === actor.id)
    return badRequest("Nhờ một quản trị khác đặt lại giúp bạn");

  const password = await resetPassword(id);
  if (!password) return new Response(null, { status: 404 });

  await logAudit(actor, {
    module: "staff",
    action: "update",
    targetLabel: `Đặt lại mật khẩu cho ${target.staff.fullName}`,
    targetTable: "users",
    targetId: id,
  });
  return Response.json({ password });
}

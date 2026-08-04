import { z } from "zod";
import { logAudit } from "@/server/audit";
import { badRequest, getActor, jsonBody, unauthorized } from "@/server/auth";
import { clearLoginLock, setStaffActive, staffTargetFor } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const target = await staffTargetFor(actor, id, "update");
  if (!target.ok) return target.response;

  // Tự khoá mình là tự đẩy mình ra khỏi hệ thống, không còn đường vào để mở lại.
  // So bằng id LẤY TỪ DB, không phải id trên URL: `uuid` của Postgres so không
  // phân biệt hoa thường, nên gửi chính uuid của mình viết hoa là lách được.
  if (target.staff.id === actor.id) return badRequest("Không khoá được tài khoản của chính bạn");

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();
  const { active } = parsed.data;

  const staff = await setStaffActive(id, active);
  if (!staff) return new Response(null, { status: 404 });

  // Mở khoá tài khoản cũng là lối thoát cho người bị khoá 15 phút vì sai mật khẩu.
  if (active) await clearLoginLock(id);

  await logAudit(actor, {
    module: "staff",
    action: active ? "update" : "delete",
    targetLabel: `${active ? "Mở khoá" : "Khoá"} nhân viên ${staff.fullName}`,
    targetTable: "users",
    targetId: id,
  });
  return Response.json(staff);
}

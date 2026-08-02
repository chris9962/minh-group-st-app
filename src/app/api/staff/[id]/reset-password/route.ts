import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { findStaff, resetPassword } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

/** C-02 · Sinh mật khẩu MỚI, hiện đúng một lần — mật khẩu cũ không đọc lại được. */
export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "update")) return forbidden();

  const { id } = await params;
  const staff = await findStaff(id);
  if (!staff) return new Response(null, { status: 404 });

  const password = await resetPassword(id);
  if (!password) return new Response(null, { status: 404 });

  await logAudit(actor, {
    module: "staff",
    action: "update",
    targetLabel: `Đặt lại mật khẩu cho ${staff.fullName}`,
    targetTable: "users",
    targetId: id,
  });
  return Response.json({ password });
}

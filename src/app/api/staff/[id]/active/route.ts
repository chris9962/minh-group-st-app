import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { clearLoginLock, setStaffActive } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "update")) return forbidden();

  const { id } = await params;
  const { active } = (await request.json()) as { active: boolean };

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

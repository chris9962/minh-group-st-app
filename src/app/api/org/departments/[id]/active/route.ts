import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { orgError, setDepartmentActive } from "@/server/org";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "manage-org")) return forbidden();

  const { id } = await params;
  const { active } = (await request.json()) as { active: boolean };
  const result = await setDepartmentActive(id, active);
  if (!result) return new Response(null, { status: 404 });
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "system",
    action: "manage-org",
    targetLabel: `${active ? "Mở lại" : "Ngừng hoạt động"} phòng ${result.department.name}`,
    targetTable: "departments",
    targetId: id,
  });
  return Response.json(result.department);
}

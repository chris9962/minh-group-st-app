import type { DepartmentForm } from "@/lib/api/org";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { departmentDetailFor, orgError, renameDepartment } from "@/server/org";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const detail = await departmentDetailFor(id);
  return detail ? Response.json(detail) : new Response(null, { status: 404 });
}

export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "manage-org")) return forbidden();

  const { id } = await params;
  const form = (await request.json()) as DepartmentForm;
  const result = await renameDepartment(id, form.name);
  if (!result) return new Response(null, { status: 404 });
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "system",
    action: "manage-org",
    targetLabel: `Đổi tên phòng thành ${result.department.name}`,
    targetTable: "departments",
    targetId: id,
  });
  return Response.json(result.department);
}

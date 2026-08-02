import type { DepartmentForm } from "@/lib/api/org";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { createDepartment, departmentsFor, orgError } from "@/server/org";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const search = new URL(request.url).searchParams.get("search") ?? "";
  return Response.json(await departmentsFor(search));
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "manage-org")) return forbidden();

  const form = (await request.json()) as DepartmentForm;
  const result = await createDepartment(form.name);
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "system",
    action: "manage-org",
    targetLabel: `Lập phòng ${result.department.name}`,
    targetTable: "departments",
    targetId: result.department.id,
  });
  return Response.json(result.department, { status: 201 });
}

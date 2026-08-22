import { DepartmentForm } from "@/lib/api/org";
import { DEPARTMENT_TYPE_LABEL } from "@/lib/types";
import { canOrg, visibleOrgDepartmentIds } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { createDepartment, departmentsFor, orgError } from "@/server/org";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // Nav chỉ ẩn link — không có middleware nên URL vẫn vào được, và route này
  // trả cả sơ đồ tổ chức kèm sĩ số từng phòng cho bất kỳ ai có phiên. Ẩn nút
  // không phải là phân quyền.
  if (!canOrg(actor, "view-detail")) return forbidden();

  const search = new URL(request.url).searchParams.get("search") ?? "";
  return Response.json(await departmentsFor(search, visibleOrgDepartmentIds(actor)));
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOrg(actor, "create")) return forbidden();

  // Máy chủ tự kiểm — `as` chỉ là lời hứa của TypeScript, body rỗng thì
  // `sameNameKey(undefined)` ném lỗi và cả request vỡ thành 500.
  const parsed = DepartmentForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createDepartment(parsed.data.name, parsed.data.type);
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "department",
    action: "create",
    targetLabel: `Lập phòng ${result.department.name} · ${DEPARTMENT_TYPE_LABEL[result.department.type]}`,
    targetTable: "departments",
    targetId: result.department.id,
  });
  return Response.json(result.department, { status: 201 });
}

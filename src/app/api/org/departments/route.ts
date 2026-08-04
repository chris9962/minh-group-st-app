import { DepartmentForm } from "@/lib/api/org";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { createDepartment, departmentsFor, orgError } from "@/server/org";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // Màn P-91 giấu sau `manage-org` ở nav, nhưng nav chỉ ẩn link — không có
  // middleware nên URL vẫn vào được, và route này trả cả sơ đồ tổ chức kèm
  // sĩ số từng phòng cho bất kỳ ai có phiên. Ẩn nút không phải là phân quyền.
  if (!can(actor, "system", "manage-org")) return forbidden();

  const search = new URL(request.url).searchParams.get("search") ?? "";
  return Response.json(await departmentsFor(search));
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "manage-org")) return forbidden();

  // Máy chủ tự kiểm — `as` chỉ là lời hứa của TypeScript, body rỗng thì
  // `sameNameKey(undefined)` ném lỗi và cả request vỡ thành 500.
  const parsed = DepartmentForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createDepartment(parsed.data.name);
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

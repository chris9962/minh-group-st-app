import { DepartmentForm } from "@/lib/api/org";
import { DEPARTMENT_TYPE_LABEL } from "@/lib/types";
import { canOrg, visibleOrgDepartmentIds } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import {
  badRequest,
  forbidden,
  getActor,
  isUuid,
  jsonBody,
  notFound,
  unauthorized,
} from "@/server/auth";
import { departmentDetailFor, orgError, updateDepartment } from "@/server/org";

type Params = { params: Promise<{ id: string }> };


export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  if (!canOrg(actor, "view-detail")) return forbidden();

  const { id } = await params;
  // Id sai dạng uuid thì Postgres ném lỗi cast — 500 cho một đường dẫn cũ
  // hay bookmark hỏng, trong khi đúng ra chỉ là "không có phòng này".
  if (!isUuid(id)) return notFound();

  const detail = await departmentDetailFor(id, visibleOrgDepartmentIds(actor));
  return detail ? Response.json(detail) : notFound();
}

export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOrg(actor, "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = DepartmentForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateDepartment(id, parsed.data.name, parsed.data.type);
  if (!result) return notFound();
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  // Loại phòng quyết định cách tính điểm KPI, nên nhật ký phải ghi lại nó —
  // "đổi tên phòng" không nói được rằng cả phòng vừa đổi cách tính lương.
  await logAudit(actor, {
    module: "department",
    action: "update",
    targetLabel: `Sửa phòng ${result.department.name} · ${DEPARTMENT_TYPE_LABEL[result.department.type]}`,
    targetTable: "departments",
    targetId: id,
  });
  return Response.json(result.department);
}

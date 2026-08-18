import { DepartmentForm } from "@/lib/api/org";
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
import { departmentDetailFor, orgError, renameDepartment } from "@/server/org";

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

  const result = await renameDepartment(id, parsed.data.name);
  if (!result) return notFound();
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "department",
    action: "update",
    targetLabel: `Đổi tên phòng thành ${result.department.name}`,
    targetTable: "departments",
    targetId: id,
  });
  return Response.json(result.department);
}

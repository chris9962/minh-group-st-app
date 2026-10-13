import { DepartmentForm } from "@/lib/api/org";
import { ATTENDANCE_MODE_LABEL, DEPARTMENT_TYPE_LABEL } from "@/lib/types";
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

  // Tháng đang xem ở màn chi tiết; thiếu hoặc sai dạng thì lấy tháng làm việc.
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const detail = await departmentDetailFor(
    id,
    visibleOrgDepartmentIds(actor),
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
  );
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

  const { name, type, attendanceMode } = parsed.data;
  const result = await updateDepartment(id, name, type, attendanceMode);
  if (!result) return notFound();
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  // Loại phòng quyết định cách tính điểm KPI, cách chấm công quyết định nguồn
  // ngày công, nên nhật ký phải ghi lại cả hai, kể cả lượt tắt chấm công:
  // "đổi tên phòng" không nói được rằng cả phòng vừa đổi cách tính lương.
  const { department } = result;
  await logAudit(actor, {
    module: "department",
    action: "update",
    targetLabel: `Sửa phòng ${department.name} - ${DEPARTMENT_TYPE_LABEL[department.type]} - Chấm công: ${ATTENDANCE_MODE_LABEL[department.attendanceMode ?? ""]}`,
    targetTable: "departments",
    targetId: id,
  });
  return Response.json(result.department);
}

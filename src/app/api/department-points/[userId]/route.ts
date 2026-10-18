import { DepartmentPointsExcludeForm } from "@/lib/api/departmentPoints";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import {
  excludeFromDepartmentPoints,
  includeInDepartmentPoints,
  monthText,
} from "@/server/departmentPoints";

type Params = { params: Promise<{ userId: string }> };

/** P-54 · Loại một nhân viên khỏi điểm phòng của một tháng. */
export async function PUT(request: Request, { params }: Params) {
  const guard = await actorWith(request, "staff", "exclude-department-points");
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  if (!isUuid(userId)) return notFound();

  const parsed = DepartmentPointsExcludeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Lý do phải là văn bản, tối đa 500 ký tự");

  const { month, note } = parsed.data;
  const result = await excludeFromDepartmentPoints(guard.actor, userId, month, note);
  if (!result) return notFound();
  if (!result.ok) return badRequest(result.message);

  await logAudit(guard.actor, {
    module: "staff",
    action: "exclude-department-points",
    targetLabel: `Loại ${result.fullName} khỏi điểm phòng ${monthText(month)}`,
    targetTable: "department_point_exclusions",
    targetId: userId,
  });
  return Response.json({ ok: true });
}

/** P-54 · Tính lại nhân viên vào điểm phòng của một tháng. */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await actorWith(request, "staff", "exclude-department-points");
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  if (!isUuid(userId)) return notFound();

  const parsed = DepartmentPointsExcludeForm.pick({ month: true }).safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const { month } = parsed.data;
  const result = await includeInDepartmentPoints(userId, month);
  if (!result) return notFound();
  if (!result.ok) return badRequest(result.message);

  await logAudit(guard.actor, {
    module: "staff",
    action: "exclude-department-points",
    targetLabel: `Tính lại ${result.fullName} vào điểm phòng ${monthText(month)}`,
    targetTable: "department_point_exclusions",
    targetId: userId,
  });
  return Response.json({ ok: true });
}

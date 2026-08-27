import { KpiAdjustmentForm } from "@/lib/api/person";
import { businessMonth, formatPoints } from "@/lib/format";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { deleteAdjustment, updateAdjustment } from "@/server/kpi-adjustments";

type Params = { params: Promise<{ id: string; adjustmentId: string }> };

/**
 * Sửa / xoá một dòng điểm cộng — chỉ dòng của THÁNG HIỆN TẠI. Dòng tháng cũ
 * trả 404 y như không tồn tại: điểm tháng đã qua coi như chốt sổ.
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "adjust-kpi");
  if (!guard.ok) return guard.response;

  const { id, adjustmentId } = await params;
  if (!isUuid(id) || !isUuid(adjustmentId)) return notFound();

  const parsed = KpiAdjustmentForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateAdjustment(guard.actor, id, adjustmentId, parsed.data);
  if (!result) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "adjust-kpi",
    targetLabel: `Sửa điểm cộng KPI tháng ${businessMonth()} của ${result.staff.fullName} thành ${formatPoints(parsed.data.points)} điểm`,
    targetTable: "kpi_adjustments",
    targetId: adjustmentId,
  });
  return Response.json(result.row);
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "adjust-kpi");
  if (!guard.ok) return guard.response;

  const { id, adjustmentId } = await params;
  if (!isUuid(id) || !isUuid(adjustmentId)) return notFound();

  const result = await deleteAdjustment(id, adjustmentId);
  if (!result) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "adjust-kpi",
    targetLabel: `Xoá dòng điểm cộng KPI ${formatPoints(result.points)} điểm tháng ${businessMonth()} của ${result.staff.fullName}`,
    targetTable: "kpi_adjustments",
    targetId: adjustmentId,
  });
  return Response.json({ ok: true });
}

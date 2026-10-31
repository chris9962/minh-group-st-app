import { SALARY_ADJUSTMENT_LABEL } from "@/lib/api/salaryAdjustments";
import { formatVnd } from "@/lib/format";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, notFound } from "@/server/auth";
import { deleteSalaryAdjustment } from "@/server/salaryAdjustments";

type Params = { params: Promise<{ id: string; adjustmentId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const { id, adjustmentId } = await params;
  if (!isUuid(id) || !isUuid(adjustmentId)) return notFound();

  const result = await deleteSalaryAdjustment(id, adjustmentId);
  if (!result) return notFound();
  if (result === "closed") return badRequest("Lương tháng này đã chốt, không xoá được.");

  await logAudit(guard.actor, {
    module: "system",
    action: "close-salary",
    targetLabel: `Xoá ${SALARY_ADJUSTMENT_LABEL[result.kind].toLowerCase()} ${formatVnd(result.amount)} tháng ${result.month} của ${result.staff.fullName}`,
    targetTable: "salary_adjustments",
    targetId: adjustmentId,
  });
  return Response.json({ ok: true });
}

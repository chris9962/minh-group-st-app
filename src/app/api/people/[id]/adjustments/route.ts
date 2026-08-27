import { KpiAdjustmentForm } from "@/lib/api/person";
import { businessMonth, formatPoints } from "@/lib/format";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { createAdjustment } from "@/server/kpi-adjustments";

type Params = { params: Promise<{ id: string }> };

/** P-52 · Cộng điểm KPI tay — luôn ghi vào tháng hiện tại. */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "adjust-kpi");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = KpiAdjustmentForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createAdjustment(guard.actor, id, parsed.data);
  if (!result) return notFound();

  const verb = parsed.data.points > 0 ? "Cộng" : "Trừ";
  await logAudit(guard.actor, {
    module: "system",
    action: "adjust-kpi",
    targetLabel: `${verb} ${formatPoints(Math.abs(parsed.data.points))} điểm KPI tháng ${businessMonth()} cho ${result.staff.fullName}`,
    targetTable: "kpi_adjustments",
    targetId: result.row.id,
  });
  return Response.json(result.row, { status: 201 });
}

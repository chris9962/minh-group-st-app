import { KpiAdjustmentCreate } from "@/lib/api/person";
import { formatPoints } from "@/lib/format";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { createAdjustment } from "@/server/kpi-adjustments";

type Params = { params: Promise<{ id: string }> };

/** P-52 · Cộng điểm KPI tay vào tháng đang xem, miễn tháng đó chưa chốt lương. */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "adjust-kpi");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = KpiAdjustmentCreate.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();
  const { month, ...form } = parsed.data;

  const result = await createAdjustment(guard.actor, id, month, form);
  if (!result) return notFound();
  if (result === "closed") return badRequest("Lương tháng này đã chốt, không cộng điểm được.");

  const verb = form.points > 0 ? "Cộng" : "Trừ";
  await logAudit(guard.actor, {
    module: "system",
    action: "adjust-kpi",
    targetLabel: `${verb} ${formatPoints(Math.abs(form.points))} điểm KPI tháng ${month} cho ${result.staff.fullName}`,
    targetTable: "kpi_adjustments",
    targetId: result.row.id,
  });
  return Response.json(result.row, { status: 201 });
}

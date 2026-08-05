import { KpiTargetForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { getKpiTarget, setKpiTarget } from "@/server/catalog";

/**
 * P-83 · Chỉ tiêu KPI theo tháng.
 *
 * Bảng chỉ giữ MỐC, không giữ công thức — công thức ở `src/rules/YYYY-MM.ts`
 * (quyết định 03/08).
 *
 * ⚠️ Mốc đang là 100, đúng thang CŨ. Thể lệ 01/8 làm thang mới nhỏ hơn khoảng
 * 2,5 lần, nên khi công thức thật lên mà mốc còn 100 thì cả công ty đều "chưa
 * đạt" (spec §7.1).
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await getKpiTarget());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = KpiTargetForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const target = await setKpiTarget(parsed.data, guard.actor.id);

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Đặt chỉ tiêu ${target.monthlyPoints} điểm/tháng`,
    targetTable: "kpi_targets",
  });
  return Response.json(target);
}

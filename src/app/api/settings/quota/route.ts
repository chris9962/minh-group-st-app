import { QuotaMonthForm } from "@/lib/api/quota";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { getQuotaMonth, saveQuotaMonth } from "@/server/quota";

const monthFrom = (request: Request): string | null => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
};

/** Chỉ tiêu tháng theo QĐ 145. Cùng quyền với màn Chỉ tiêu KPI P-83. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();
  return Response.json(await getQuotaMonth(month));
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();

  const parsed = QuotaMonthForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const saved = await saveQuotaMonth(month, parsed.data, guard.actor.id);
  if (!saved)
    return Response.json(
      { message: "Lương tháng này đã chốt, không sửa được chỉ tiêu." },
      { status: 409 },
    );

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Lưu chỉ tiêu tháng ${month}`,
    targetTable: "quota_months",
  });
  return Response.json(saved);
}

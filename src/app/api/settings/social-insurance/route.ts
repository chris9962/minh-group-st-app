import { SocialInsuranceSettingsForm } from "@/lib/api/socialInsuranceSettings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { getSocialInsuranceSettings, saveSocialInsuranceSettings } from "@/server/socialInsuranceSettings";

const monthFrom = (request: Request): string | null => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
};

/** % hoa hồng BHYT/BHXH và mức điểm KPI An Sinh theo tháng. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();
  return Response.json(await getSocialInsuranceSettings(month));
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();

  const parsed = SocialInsuranceSettingsForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await saveSocialInsuranceSettings(month, parsed.data, guard.actor.id);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Lưu cấu hình BHYT/BHXH tháng ${month}`,
    targetTable: "social_insurance_rates",
  });
  return Response.json(result.settings);
}

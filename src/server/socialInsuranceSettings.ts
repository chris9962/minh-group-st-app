import { asc, desc, eq, gte, lte } from "drizzle-orm";
import {
  KIND_LABEL,
  PLAN_LABEL,
  SocialInsuranceKind,
  SocialInsurancePlan,
} from "@/lib/api/socialInsurance";
import {
  MAX_RATE_MONTHS,
  type SocialInsuranceSettings,
  type SocialInsuranceSettingsForm,
} from "@/lib/api/socialInsuranceSettings";
import { isMonthClosed } from "./closedMonths";
import { db } from "./db/client";
import { socialInsuranceKpiRates, socialInsuranceRates, socialInsuranceRecords } from "./db/schema";
import { recomputeKpi } from "./kpi";

/** Tháng có dòng thật gần nhất, không sau `month`. */
async function effectiveMonth(
  table: typeof socialInsuranceRates | typeof socialInsuranceKpiRates,
  month: string,
): Promise<string | null> {
  const [row] = await db
    .select({ yearMonth: table.yearMonth })
    .from(table)
    .where(lte(table.yearMonth, month))
    .orderBy(desc(table.yearMonth))
    .limit(1);
  return row?.yearMonth ?? null;
}

/**
 * Bộ số của tháng. Tháng chưa lưu bộ riêng thì trả bộ của tháng gần nhất trước
 * đó, kèm `ratesFrom`/`kpiFrom` để màn báo đang dùng bộ của tháng nào.
 */
export async function getSocialInsuranceSettings(month: string): Promise<SocialInsuranceSettings> {
  const [ratesMonth, kpiMonth, locked] = await Promise.all([
    effectiveMonth(socialInsuranceRates, month),
    effectiveMonth(socialInsuranceKpiRates, month),
    isMonthClosed(month),
  ]);
  const [rates, kpi] = await Promise.all([
    ratesMonth
      ? db
          .select({
            kind: socialInsuranceRates.kind,
            plan: socialInsuranceRates.plan,
            months: socialInsuranceRates.months,
            receiveRate: socialInsuranceRates.receiveRate,
            payRate: socialInsuranceRates.payRate,
          })
          .from(socialInsuranceRates)
          .where(eq(socialInsuranceRates.yearMonth, ratesMonth))
          .orderBy(asc(socialInsuranceRates.kind), asc(socialInsuranceRates.plan), asc(socialInsuranceRates.months))
      : [],
    kpiMonth
      ? db
          .select({
            kind: socialInsuranceKpiRates.kind,
            plan: socialInsuranceKpiRates.plan,
            revenuePerPoint: socialInsuranceKpiRates.revenuePerPoint,
          })
          .from(socialInsuranceKpiRates)
          .where(eq(socialInsuranceKpiRates.yearMonth, kpiMonth))
      : [],
  ]);
  return {
    month,
    ratesFrom: ratesMonth && ratesMonth !== month ? ratesMonth : null,
    kpiFrom: kpiMonth && kpiMonth !== month ? kpiMonth : null,
    locked,
    rates,
    kpi,
  };
}

/** Lỗi đầu tiên của bộ số gửi lên, hoặc `null`. */
function invalidReason(form: SocialInsuranceSettingsForm): string | null {
  if (form.rates.length === 0) return "Chưa có dòng % hoa hồng.";
  const seen = new Set<string>();
  for (const r of form.rates) {
    const label = `${KIND_LABEL[r.kind]} ${PLAN_LABEL[r.plan]}`;
    if (r.plan === "renewal" && r.months !== 0) return `${label} dùng một mức cho mọi số tháng.`;
    if (r.plan === "new" && (r.months < 1 || r.months > MAX_RATE_MONTHS))
      return `${label}: số tháng từ 1 đến ${MAX_RATE_MONTHS}.`;
    const key = `${r.kind}|${r.plan}|${r.months}`;
    if (seen.has(key)) return `${label}${r.months ? ` ${r.months} tháng` : ""} bị lặp.`;
    seen.add(key);
  }
  for (const kind of SocialInsuranceKind.options)
    if (!seen.has(`${kind}|renewal|0`)) return `Thiếu dòng ${KIND_LABEL[kind]} ${PLAN_LABEL.renewal}.`;
  const seenKpi = new Set<string>();
  for (const k of form.kpi) {
    const label = `${KIND_LABEL[k.kind]} ${PLAN_LABEL[k.plan]}`;
    if (k.revenuePerPoint <= 0) return `Mức điểm ${label} phải lớn hơn 0.`;
    const key = `${k.kind}|${k.plan}`;
    if (seenKpi.has(key)) return `Mức điểm ${label} bị lặp.`;
    seenKpi.add(key);
  }
  for (const kind of SocialInsuranceKind.options)
    for (const plan of SocialInsurancePlan.options)
      if (!seenKpi.has(`${kind}|${plan}`)) return `Thiếu mức điểm ${KIND_LABEL[kind]} ${PLAN_LABEL[plan]}.`;
  return null;
}

export type SettingsOutcome =
  | { ok: true; settings: SocialInsuranceSettings }
  | { ok: false; status: 409 | 422; message: string };

/** Lưu trọn bộ số của MỘT tháng: thay mọi dòng của tháng đó. Tháng đã chốt lương thì không sửa. */
export async function saveSocialInsuranceSettings(
  month: string,
  form: SocialInsuranceSettingsForm,
  actorId: string,
): Promise<SettingsOutcome> {
  if (await isMonthClosed(month))
    return { ok: false, status: 409, message: "Lương tháng này đã chốt, không sửa được cấu hình." };
  const reason = invalidReason(form);
  if (reason) return { ok: false, status: 422, message: reason };

  await db.transaction(async (tx) => {
    await tx.delete(socialInsuranceRates).where(eq(socialInsuranceRates.yearMonth, month));
    await tx.delete(socialInsuranceKpiRates).where(eq(socialInsuranceKpiRates.yearMonth, month));
    if (form.rates.length > 0)
      await tx
        .insert(socialInsuranceRates)
        .values(form.rates.map((r) => ({ ...r, yearMonth: month, updatedBy: actorId })));
    if (form.kpi.length > 0)
      await tx
        .insert(socialInsuranceKpiRates)
        .values(form.kpi.map((k) => ({ ...k, yearMonth: month, updatedBy: actorId })));
  });

  // Các tháng sau chưa có bộ riêng cũng đang dùng bộ vừa lưu.
  const uploads = await db
    .selectDistinct({ userId: socialInsuranceRecords.uploadedBy, month: socialInsuranceRecords.receiptMonth })
    .from(socialInsuranceRecords)
    .where(gte(socialInsuranceRecords.receiptMonth, month));
  for (const u of uploads) await recomputeKpi(u.userId, u.month);

  return { ok: true, settings: await getSocialInsuranceSettings(month) };
}

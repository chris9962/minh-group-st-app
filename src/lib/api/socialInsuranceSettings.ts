import { z } from 'zod';
import { SocialInsuranceKind, SocialInsurancePlan } from './socialInsurance';

/**
 * Trang cấu hình BHYT/BHXH theo tháng (spec docs/spec-bhyt-bhxh-an-sinh.md mục
 * 2): % hoa hồng và mức điểm KPI An Sinh. % theo đơn vị 0,001% như `lib/money.ts`.
 */

export const MAX_RATE_MONTHS = 120;
export const MAX_REVENUE_PER_POINT = 2_000_000_000;

export const RateRow = z.object({
  kind: SocialInsuranceKind,
  plan: SocialInsurancePlan,
  /** Tái tục luôn là 0: một mức cho mọi số tháng. */
  months: z.number().int().min(0).max(MAX_RATE_MONTHS),
  receiveRate: z.number().int().min(0).max(100_000),
  payRate: z.number().int().min(0).max(100_000),
});
export type RateRow = z.infer<typeof RateRow>;

export const KpiRateRow = z.object({
  kind: SocialInsuranceKind,
  plan: SocialInsurancePlan,
  /** Doanh thu bao nhiêu đồng thì được 1 điểm. */
  revenuePerPoint: z.number().int().positive().max(MAX_REVENUE_PER_POINT),
});
export type KpiRateRow = z.infer<typeof KpiRateRow>;

export const SocialInsuranceSettings = z.object({
  month: z.string(),
  /** Tháng có dòng thật mà tháng này đang dùng. `null` = tháng này có bộ số riêng hoặc chưa có tháng nào. */
  ratesFrom: z.string().nullable(),
  kpiFrom: z.string().nullable(),
  /** Tháng đã chốt lương: không sửa. */
  locked: z.boolean(),
  rates: z.array(RateRow),
  kpi: z.array(KpiRateRow),
});
export type SocialInsuranceSettings = z.infer<typeof SocialInsuranceSettings>;

export const SocialInsuranceSettingsForm = z.object({
  rates: z.array(RateRow).max(60),
  kpi: z.array(KpiRateRow).max(4),
});
export type SocialInsuranceSettingsForm = z.infer<typeof SocialInsuranceSettingsForm>;

export async function fetchSocialInsuranceSettings(month: string): Promise<SocialInsuranceSettings> {
  const res = await fetch(`/api/settings/social-insurance?month=${month}`);
  if (!res.ok) throw new Error('Không đọc được cấu hình BHYT/BHXH');
  return SocialInsuranceSettings.parse(await res.json());
}

export async function saveSocialInsuranceSettings(
  month: string,
  form: SocialInsuranceSettingsForm,
): Promise<SocialInsuranceSettings> {
  const res = await fetch(`/api/settings/social-insurance?month=${month}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không lưu được cấu hình BHYT/BHXH');
  return SocialInsuranceSettings.parse(data);
}

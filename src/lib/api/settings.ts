import { z } from 'zod';

/**
 * Cấu hình cho CEO — P-81…P-84 (mgst-feature-list.md §4.8).
 *
 * Ngân hàng bắt buộc trong quy tắc quà tra trực tiếp vào P-60
 * (`@/lib/api/bankCatalog`, `fetchBanks`), không có danh sách riêng ở đây nữa.
 * `CHANNEL_CODES` vẫn là hằng số TẠM — P-70 (Danh mục kênh) chưa có bảng/API
 * thật trong code.
 */
export const CHANNEL_CODES = ['Bệnh viện', 'Ấp', 'Định danh'] as const;

/* ── P-82 · Danh mục quà & gói bảo hiểm ──────────────────────────────── */

export const GiftItem = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type GiftItem = z.infer<typeof GiftItem>;

export const InsurancePackage = z.object({
  id: z.string(),
  name: z.string(),
  /** Đồng/năm — ví dụ "BH điện 100k" = 100000. */
  yearlyFee: z.number(),
  active: z.boolean(),
});
export type InsurancePackage = z.infer<typeof InsurancePackage>;

export const CatalogItemForm = z.object({
  name: z.string().trim().min(2, 'Chưa nhập tên'),
});
export type CatalogItemForm = z.infer<typeof CatalogItemForm>;

export const InsurancePackageForm = z.object({
  name: z.string().trim().min(2, 'Chưa nhập tên gói'),
  yearlyFee: z.number().min(0, 'Phí phải từ 0 trở lên'),
});
export type InsurancePackageForm = z.infer<typeof InsurancePackageForm>;

/* ── P-81 · Quy tắc quà ───────────────────────────────────────────────── */

export const GiftGroup = z.enum(['cash', 'choice']);
export type GiftGroup = z.infer<typeof GiftGroup>;

export const GIFT_GROUP_LABEL: Record<GiftGroup, string> = {
  cash: 'Tiền mặt',
  choice: 'Quà chọn',
};

export const GiftRuleMode = z.enum(['accumulate', 'tiered', 'addon']);
export type GiftRuleMode = z.infer<typeof GiftRuleMode>;

export const GIFT_MODE_LABEL: Record<GiftRuleMode, string> = {
  accumulate: 'Cộng dồn',
  tiered: 'Bậc thang',
  addon: 'Góp thêm',
};

/** Nhóm nào đi với cách chạy nào — nhóm Tiền mặt luôn cộng dồn (spec §5.2). */
export const MODES_FOR_GROUP: Record<GiftGroup, GiftRuleMode[]> = {
  cash: ['accumulate'],
  choice: ['tiered', 'addon'],
};

export const AppCountComparator = z.enum(['none', 'eq', 'gte']);
export type AppCountComparator = z.infer<typeof AppCountComparator>;

export const APP_COMPARATOR_LABEL: Record<AppCountComparator, string> = {
  none: '—',
  eq: '=',
  gte: '≥',
};

export const GiftRule = z.object({
  id: z.string(),
  /** Vị trí ưu tiên — bậc thang khớp dòng nhỏ nhất trước rồi dừng. */
  order: z.number(),
  group: GiftGroup,
  mode: GiftRuleMode,
  /** null = không yêu cầu ngân hàng cụ thể. */
  requiredBank: z.string().nullable(),
  /** Cờ riêng cho điều kiện "mở CNKD ở HKD" — không phải một ngân hàng. */
  requiresCnkd: z.boolean(),
  appCountComparator: AppCountComparator,
  appCountValue: z.number().nullable(),
  /** null = không yêu cầu kênh cụ thể. */
  channel: z.string().nullable(),
  /** Chỉ dùng khi group = 'cash'. */
  cashAmount: z.number().nullable(),
  /** Chỉ dùng khi group = 'choice' — id món trong GiftItem hoặc InsurancePackage. */
  giftItemIds: z.array(z.string()),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  active: z.boolean(),
});
export type GiftRule = z.infer<typeof GiftRule>;

/**
 * Biểu mẫu lập / sửa quy tắc.
 *
 * Chuỗi rỗng thay cho null ở các ô không bắt buộc — giữ đúng nguyên tắc
 * không `.default()` trong schema form, mặc định đặt ở `defaultValues`.
 */
export const GiftRuleForm = z.object({
  group: GiftGroup,
  mode: GiftRuleMode,
  requiredBank: z.string(),
  requiresCnkd: z.boolean(),
  appCountComparator: AppCountComparator,
  appCountValue: z.number(),
  channel: z.string(),
  cashAmount: z.number(),
  giftItemIds: z.array(z.string()),
  effectiveFrom: z.string().trim().min(1, 'Chưa chọn ngày hiệu lực'),
  effectiveTo: z.string(),
});
export type GiftRuleForm = z.infer<typeof GiftRuleForm>;

/* ── Nút thử — chỉ tính toán, không ghi gì (spec §5.3) ──────────────── */

export const GiftSimulateInput = z.object({
  installedBanks: z.array(z.string()),
  cnkd: z.boolean(),
  /** '' = không thuộc kênh nào. */
  channel: z.string(),
});
export type GiftSimulateInput = z.infer<typeof GiftSimulateInput>;

export const GiftSimulateResult = z.object({
  cashTotal: z.number(),
  cashBreakdown: z.array(z.object({ label: z.string(), amount: z.number() })),
  basket: z.array(z.object({ id: z.string(), name: z.string(), source: z.string() })),
  kpiPoints: z.number(),
  kpiBreakdown: z.array(z.object({ label: z.string(), points: z.number() })),
});
export type GiftSimulateResult = z.infer<typeof GiftSimulateResult>;

/* ── P-83 · Chỉ tiêu KPI theo tháng ──────────────────────────────────── */

export const KpiTarget = z.object({
  monthlyPoints: z.number(),
  /** Cảnh báo nhẹ khi còn bấy nhiêu ngày mà chưa đạt (spec §4.8 P-83, mở). */
  warnDaysLeft: z.number(),
});
export type KpiTarget = z.infer<typeof KpiTarget>;

export const KpiTargetForm = z.object({
  monthlyPoints: z.number().min(1, 'Chỉ tiêu phải lớn hơn 0'),
  warnDaysLeft: z.number().min(0, 'Số ngày phải từ 0 trở lên'),
});
export type KpiTargetForm = z.infer<typeof KpiTargetForm>;

/* ── P-84 · Danh mục loại dịch vụ + hệ số điểm ───────────────────────── */

export const ServiceTypeRow = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  coefficient: z.number(),
});
export type ServiceTypeRow = z.infer<typeof ServiceTypeRow>;

export const ServiceTypeForm = z.object({
  name: z.string().trim().min(2, 'Chưa nhập tên loại dịch vụ'),
  coefficient: z.number().min(0, 'Hệ số phải từ 0 trở lên'),
});
export type ServiceTypeForm = z.infer<typeof ServiceTypeForm>;

/* ── Gọi API ──────────────────────────────────────────────────────────── */

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Không lưu được');
  return res.json();
}

export const fetchGiftRules = (): Promise<GiftRule[]> =>
  fetch('/api/settings/gift-rules')
    .then((r) => r.json())
    .then((d) => z.array(GiftRule).parse(d));

export const createGiftRule = (form: GiftRuleForm) =>
  send('/api/settings/gift-rules', 'POST', form).then(GiftRule.parse);

export const updateGiftRule = (id: string, form: GiftRuleForm) =>
  send(`/api/settings/gift-rules/${id}`, 'PATCH', form).then(GiftRule.parse);

export const moveGiftRule = (id: string, direction: 'up' | 'down') =>
  send(`/api/settings/gift-rules/${id}/move`, 'POST', { direction }).then((d) =>
    z.array(GiftRule).parse(d),
  );

export const setGiftRuleActive = (id: string, active: boolean) =>
  send(`/api/settings/gift-rules/${id}/active`, 'POST', { active }).then(GiftRule.parse);

export const simulateGift = (input: GiftSimulateInput): Promise<GiftSimulateResult> =>
  send('/api/settings/gift-rules/simulate', 'POST', input).then(GiftSimulateResult.parse);

export const fetchGiftItems = (): Promise<GiftItem[]> =>
  fetch('/api/settings/gift-items')
    .then((r) => r.json())
    .then((d) => z.array(GiftItem).parse(d));

export const createGiftItem = (form: CatalogItemForm) =>
  send('/api/settings/gift-items', 'POST', form).then(GiftItem.parse);

export const setGiftItemActive = (id: string, active: boolean) =>
  send(`/api/settings/gift-items/${id}/active`, 'POST', { active }).then(GiftItem.parse);

export const fetchInsurancePackages = (): Promise<InsurancePackage[]> =>
  fetch('/api/settings/insurance-packages')
    .then((r) => r.json())
    .then((d) => z.array(InsurancePackage).parse(d));

export const createInsurancePackage = (form: InsurancePackageForm) =>
  send('/api/settings/insurance-packages', 'POST', form).then(InsurancePackage.parse);

export const updateInsurancePackage = (id: string, form: InsurancePackageForm) =>
  send(`/api/settings/insurance-packages/${id}`, 'PATCH', form).then(InsurancePackage.parse);

export const setInsurancePackageActive = (id: string, active: boolean) =>
  send(`/api/settings/insurance-packages/${id}/active`, 'POST', { active }).then(
    InsurancePackage.parse,
  );

export const fetchKpiTarget = (): Promise<KpiTarget> =>
  fetch('/api/settings/kpi-target')
    .then((r) => r.json())
    .then((d) => KpiTarget.parse(d));

export const updateKpiTarget = (form: KpiTargetForm) =>
  send('/api/settings/kpi-target', 'POST', form).then(KpiTarget.parse);

export const fetchServiceTypes = (): Promise<ServiceTypeRow[]> =>
  fetch('/api/settings/service-types')
    .then((r) => r.json())
    .then((d) => z.array(ServiceTypeRow).parse(d));

export const createServiceType = (form: ServiceTypeForm) =>
  send('/api/settings/service-types', 'POST', form).then(ServiceTypeRow.parse);

export const updateServiceType = (id: string, form: ServiceTypeForm) =>
  send(`/api/settings/service-types/${id}`, 'PATCH', form).then(ServiceTypeRow.parse);

export const setServiceTypeActive = (id: string, active: boolean) =>
  send(`/api/settings/service-types/${id}/active`, 'POST', { active }).then(ServiceTypeRow.parse);

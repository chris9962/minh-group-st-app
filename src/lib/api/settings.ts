import { z } from 'zod';

/**
 * Cấu hình cho CEO — P-81…P-84 (mgst-feature-list.md §4.8).
 *
 * Ngân hàng bắt buộc trong quy tắc quà tra trực tiếp vào P-60
 * (`@/lib/api/bankCatalog`, `fetchBanks`), kênh tra vào P-70
 * (`@/lib/api/channelCatalog`, `fetchChannels`) — không có danh sách riêng ở
 * đây nữa.
 */

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

/* ── Quy tắc quà — CHỈ CÒN NÚT THỬ ───────────────────────────────────── */

/**
 * Bộ kiểu mô tả quy tắc quà (GiftRule, GiftRuleForm, GiftGroup, GiftRuleMode,
 * AppCountComparator) đã bị gỡ cùng bảng `gift_rules`/`gift_rule_items` trong
 * DB — quyết định 03/08 chuyển luật sang module code theo kỳ
 * (`src/rules/YYYY-MM.ts`), admin không sửa được nữa.
 *
 * Chúng mô tả HÌNH DẠNG luật cũ (danh sách dòng phẳng, kéo thứ tự, bật tắt).
 * Luật mới là hai bảng tách theo Combo 2 / Combo 3, trong đó Combo 3 là bậc
 * thang KHỚP DÒNG ĐẦU THÌ DỪNG — thứ tự là một phần của luật, không phải thứ
 * admin sắp xếp. Đừng khôi phục bộ kiểu cũ để hiển thị luật mới.
 */

/* ── Nút thử — chỉ tính toán, không ghi gì (spec §5.3) ──────────────── */

export const GiftSimulateInput = z.object({
  installedBanks: z.array(z.string()),
  cnkd: z.boolean(),
  /**
   * Một khách có thể mở tài khoản qua nhiều kênh khác nhau — mảng chứ không
   * phải một chuỗi, để hồ sơ khách hàng (P-42) truyền đủ mọi kênh khách đã
   * dùng, không chỉ kênh của tài khoản gần nhất.
   */
  channels: z.array(z.string()),
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

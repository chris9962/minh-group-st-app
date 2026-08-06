import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';
import { COEFFICIENT_MAX, INT_MAX, SMALLINT_MAX } from './limits';

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

/**
 * Một leg = MỘT đơn bảo hiểm mà gói này sinh ra (chốt 04/08).
 *
 * `fee` là phí TRỌN THỜI HẠN của đơn đó, không phải phí mỗi năm — khớp thẳng
 * `insurance_orders.fee` nên điền sang không phải quy đổi.
 */
export const InsurancePackageLeg = z.object({
  product: InsuranceProduct,
  years: z.number(),
  fee: z.number(),
});
export type InsurancePackageLeg = z.infer<typeof InsurancePackageLeg>;

/**
 * ⚠️ `name` CHỈ để hiển thị. Không code nào được đọc chuỗi này để suy ra sản
 * phẩm, số năm hay số đơn — cấu trúc nằm ở `legs`.
 *
 * Không còn `yearlyFee`: phí thuộc về từng leg, giá gói là `sum(legs.fee)` —
 * tính ra được thì không lưu (db-design §9).
 */
export const InsurancePackage = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  legs: z.array(InsurancePackageLeg),
});
export type InsurancePackage = z.infer<typeof InsurancePackage>;

/** Giá gói hiển thị ở P-82 — cộng phí các đơn nó sinh ra. */
export const packageTotalFee = (p: InsurancePackage): number =>
  p.legs.reduce((sum, leg) => sum + leg.fee, 0);

export const CatalogItemForm = z.object({
  name: z.string().trim().min(2, 'Chưa nhập tên'),
});
export type CatalogItemForm = z.infer<typeof CatalogItemForm>;

export const InsurancePackageLegForm = z.object({
  product: InsuranceProduct,
  years: z.int('Số năm phải là số nguyên').min(1, 'Số năm phải từ 1 trở lên').max(SMALLINT_MAX, 'Số năm lớn quá'),
  fee: z.int('Phí phải là số nguyên đồng').min(0, 'Phí phải từ 0 trở lên').max(INT_MAX, 'Phí lớn quá'),
});
export type InsurancePackageLegForm = z.infer<typeof InsurancePackageLegForm>;

export const InsurancePackageForm = z.object({
  name: z.string().trim().min(2, 'Chưa nhập tên gói'),
  /** Ít nhất một leg: gói không sinh đơn nào thì không dùng để làm gì. */
  legs: z.array(InsurancePackageLegForm).min(1, 'Gói phải có ít nhất một đơn'),
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
  monthlyPoints: z.int('Chỉ tiêu phải là số nguyên').min(1, 'Chỉ tiêu phải lớn hơn 0').max(INT_MAX, 'Chỉ tiêu lớn quá'),
  warnDaysLeft: z.int('Số ngày phải là số nguyên').min(0, 'Số ngày phải từ 0 trở lên').max(31, 'Nhiều nhất 31 ngày'),
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
  coefficient: z
    .number()
    .min(0, 'Hệ số phải từ 0 trở lên')
    .max(COEFFICIENT_MAX, `Hệ số nhiều nhất ${COEFFICIENT_MAX}`)
    .multipleOf(0.01, 'Hệ số nhiều nhất 2 chữ số thập phân'),
});
export type ServiceTypeForm = z.infer<typeof ServiceTypeForm>;

/* ── Gọi API ──────────────────────────────────────────────────────────── */

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // Máy chủ đã nói rõ vì sao ("Mã ngân hàng này đã có") — nuốt đi rồi ném câu
    // chung chung là bắt người dùng tự đoán mình sai chỗ nào.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message?.trim() || 'Không lưu được');
  }
  return res.json();
}

/**
 * TODO(P-81, chờ `src/rules/2026-08.ts`): route CHƯA TỒN TẠI, gọi vào là 404.
 *
 * Màn thử quy tắc quà không chạy được cho tới khi có file luật của kỳ — quy tắc
 * quà là chính sách nằm ở code, không phải dữ liệu trong bảng (quyết định
 * 03/08). Gỡ mốc này ở cả hai đầu khi dựng
 * `src/app/api/settings/gift-rules/simulate/route.ts`.
 */
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

/** `null` = chưa đặt mốc nào. Khác hẳn tải hỏng, và nơi gọi phải nói khác nhau. */
export const fetchKpiTarget = (): Promise<KpiTarget | null> =>
  fetch('/api/settings/kpi-target').then(async (r) => {
    if (!r.ok) throw new Error('Không tải được chỉ tiêu KPI');
    return KpiTarget.nullable().parse(await r.json());
  });

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

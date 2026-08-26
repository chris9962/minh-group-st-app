import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';
import { AccountType } from './bankAccounts';
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

/**
 * Luật kỳ 2026-08 xét theo TỪNG TÀI KHOẢN, không theo "tổng số app đã cài" như
 * luật cũ: chỉ `VPa` và `MSBa` mới đòi cài app, và hạng của từng ngân hàng
 * quyết định điểm. Nên ô nhập phải khai từng dòng một.
 */
export const GiftSimulateAccount = z.object({
  bankCode: z.string().min(1, 'Chưa chọn ngân hàng'),
  appInstalled: z.boolean(),
  /**
   * Chỉ `VPa` mở được CNKD/HKD (spec §4.9) — dòng ngân hàng khác gửi lên thì
   * `giftSimulate` bỏ qua. `default` để đợt gọi cũ không kèm trường này vẫn chạy.
   */
  accountType: AccountType.default('none'),
});
export type GiftSimulateAccount = z.infer<typeof GiftSimulateAccount>;

export const GiftSimulateInput = z.object({
  accounts: z.array(GiftSimulateAccount),
  /**
   * Một khách có thể mở tài khoản qua nhiều kênh khác nhau — mảng chứ không
   * phải một chuỗi, để hồ sơ khách hàng (P-42) truyền đủ mọi kênh khách đã
   * dùng, không chỉ kênh của tài khoản gần nhất.
   */
  channelCodes: z.array(z.string()),
  /**
   * Mã phòng của người phụ trách. `PHONG-Y` và `PHONG-DU-AN` được quy đổi quà
   * (thể lệ lưu ý 2), và từ 2026-08-25 hai phòng cho rổ KHÁC NHAU — riêng
   * Phòng Y có thêm Bảng mica. Ô chọn ở P-81 vì thế phải là ba lựa chọn, không
   * phải một ô tick.
   */
  departmentCode: z.string().nullable(),
  /**
   * Món quà khách ĐÃ nhận — mã danh mục, `null` là chưa phát gì.
   *
   * Đầu vào của phép tính ĐIỂM từ chốt 2026-08-24 (thể lệ mục 4c): phát `Mì`
   * hay `Nón` cho khách CNKD một ngân hàng đưa điểm xuống 0,7 thay vì 1,5.
   * Không có trường này thì màn thử không ra được mức 0,7.
   *
   * `default` để đợt gọi cũ không kèm trường này vẫn chạy.
   */
  grantedItem: z.string().nullable().default(null),
  /**
   * Ngày tra luật, `YYYY-MM-DD`. Bỏ trống thì máy chủ dùng ngày làm việc.
   *
   * Cần cho ngày có kỳ thứ hai: `giftFor` chọn file luật theo ngày, nên không
   * hỏi ngày thì màn chỉ thử được kỳ đang hiệu lực.
   */
  at: z.string().nullable().default(null),
});
export type GiftSimulateInput = z.infer<typeof GiftSimulateInput>;

export const GiftSimulateResult = z.object({
  /** `TH1`…`TH6` của bảng quà; `null` khi khách chưa đủ combo nào. */
  caseCode: z.string().nullable(),
  insuranceYears: z.number(),
  cashTotal: z.number(),
  cashBreakdown: z.array(z.object({ label: z.string(), amount: z.number() })),
  /**
   * Rổ quà — trả về ĐỦ mọi món luật cho, kể cả món danh mục đã ngừng hoặc
   * không còn dòng nào. Lọc bỏ ở máy chủ thì rổ 4 món tụt còn 2 mà không ai
   * biết; giữ lại kèm `status` để màn nói được "đủ điều kiện nhưng ngưng cấp".
   *
   * `id` là `null` khi `status = "missing"` — mã trong file luật không tra ra
   * dòng nào trong danh mục, lúc đó `name` rơi về chính mã đó.
   */
  basket: z.array(
    z.object({
      id: z.string().nullable(),
      /**
       * `default` ở đây KHÔNG phải để cho tiện: `gift_grants.snapshot` đóng băng
       * nguyên kết quả lúc phát, nên đợt chốt trước 11/08 không có hai trường
       * này. Snapshot là bản ghi lịch sử, không vá ngược được — nên chỗ đọc
       * phải chịu được cả hai hình dạng.
       */
      code: z.string().default(''),
      name: z.string(),
      source: z.string(),
      /** Món phát được ở thời điểm chốt, nên đợt cũ quy về `ok`. */
      status: z.enum(['ok', 'discontinued', 'missing']).default('ok'),
    }),
  ),
  /**
   * Điểm COMBO của khách — thứ quyết định bậc quà (TH1…TH6). Tên trường là di
   * sản và không đổi được: nó đã đóng băng trong `gift_grants.snapshot` của
   * mọi đợt đã phát.
   *
   * ĐỪNG đọc nó như điểm KPI trả lương. Điểm KPI chỉ tính tài khoản mở TRONG
   * tháng đang tính (thể lệ câu 7.13); con số này tính trên toàn bộ tài khoản
   * `done` của khách, đúng theo luật quà (câu 7.15). Khách mở vắt hai tháng
   * thì hai số lệch nhau, và cả hai đều đúng với việc của mình.
   */
  kpiPoints: z.number(),
  kpiBreakdown: z.array(z.object({ label: z.string(), points: z.number() })),
  /**
   * Phần điểm CNKD/HKD (thể lệ mục 4c) — KHÔNG nằm trong `kpiPoints`.
   *
   * Hai trường tách nhau vì trả lời hai câu khác nhau: `kpiPoints` quyết định
   * bậc quà, con số này thì không. Gộp lại thì màn nói "combo TH2" cạnh một số
   * điểm không phải của combo nào.
   *
   * `default` để snapshot `gift_grants` chốt trước 2026-08-26 vẫn parse được —
   * snapshot là bản ghi lịch sử, không vá ngược.
   */
  householdPoints: z.number().default(0),
  /** Vì sao ra mức đó — rỗng khi khách không có CNKD. */
  householdNote: z.string().default(''),
  /** Vì sao ra kết quả này — khách hỏi thì nhân viên đọc thẳng ở màn (spec §5.3). */
  explain: z.array(z.string()),
});
export type GiftSimulateResult = z.infer<typeof GiftSimulateResult>;

/** Rổ rỗng dùng khi kỳ chưa có file luật — KHÁC hẳn "đã tính, không đủ điều kiện". */
export const EMPTY_GIFT: GiftSimulateResult = {
  caseCode: null,
  insuranceYears: 0,
  cashTotal: 0,
  cashBreakdown: [],
  basket: [],
  kpiPoints: 0,
  kpiBreakdown: [],
  householdPoints: 0,
  householdNote: '',
  explain: [],
};

/* ── P-83 · Chỉ tiêu KPI theo tháng ──────────────────────────────────── */

export const KpiTarget = z.object({
  monthlyPoints: z.number(),
});
export type KpiTarget = z.infer<typeof KpiTarget>;

export const KpiTargetForm = z.object({
  monthlyPoints: z.int('Chỉ tiêu phải là số nguyên').min(1, 'Chỉ tiêu phải lớn hơn 0').max(INT_MAX, 'Chỉ tiêu lớn quá'),
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

/** P-81 · chạy thử luật của kỳ trên dữ liệu tự bịa — máy chủ không ghi gì. */
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

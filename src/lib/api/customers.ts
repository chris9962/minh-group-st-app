import { z } from 'zod';
import { InsuranceOrderStatus } from './insuranceOrders';
import { GiftSimulateResult } from './settings';

/**
 * P-40 · Danh sách khách hàng · P-41 · Tạo/sửa · P-42 · Hồ sơ 360°
 * (mgst-platform-spec.md §2.1, §2.1b · mgst-feature-list.md §4.4).
 *
 * Hồ sơ khách hàng KHÔNG áp trục phạm vi — mọi nhân viên xem được mọi khách.
 * Chỉ tài khoản/đơn/dịch vụ của khách mới áp phạm vi (§2.1b).
 */

export const CustomerPhone = z.object({
  id: z.string(),
  number: z.string(),
  primary: z.boolean(),
});
export type CustomerPhone = z.infer<typeof CustomerPhone>;

export const Customer = z.object({
  id: z.string(),
  fullName: z.string(),
  /** '' hoặc ngày sinh dạng YYYY-MM-DD. */
  dob: z.string().nullable(),
  /** null = chưa có CCCD — module B không bắt buộc (spec §2.1 câu hỏi mở). */
  idNumber: z.string().nullable(),
  address: z.string(),
  phones: z.array(CustomerPhone),
  /**
   * Nguồn khách (spec §2.3) — thuộc về KHÁCH, không thuộc về từng tài khoản
   * ngân hàng: một khách chỉ được một kênh, dù mở bao nhiêu tài khoản sau đó.
   * '' = không có kênh.
   */
  channel: z.string(),
  channelDetail: z.string(),
  /** Ngày tạo hồ sơ, YYYY-MM-DD — dùng để lọc ở P-40 (hôm nay/tháng này/khoảng ngày). */
  createdAt: z.string(),
});
export type Customer = z.infer<typeof Customer>;

/** Một dòng ở P-40 — tóm tắt, không phải hồ sơ đầy đủ. */
export const CustomerRow = z.object({
  id: z.string(),
  fullName: z.string(),
  primaryPhone: z.string(),
  accountCount: z.number(),
  insuranceCount: z.number(),
  giftStatus: z.enum(['none', 'eligible', 'given']),
  /** Tên món đã tặng — chỉ có giá trị khi giftStatus = 'given'. */
  givenItem: z.string().nullable(),
  channel: z.string(),
  createdAt: z.string(),
});
export type CustomerRow = z.infer<typeof CustomerRow>;

export const CustomerList = z.object({
  summary: z.object({ total: z.number() }),
  customers: z.array(CustomerRow),
});
export type CustomerList = z.infer<typeof CustomerList>;

export const CustomerQuery = z.object({
  search: z.string(),
  channel: z.string(),
  from: z.string(),
  to: z.string(),
});
export type CustomerQuery = z.infer<typeof CustomerQuery>;

export async function fetchCustomers(query: CustomerQuery): Promise<CustomerList> {
  const params = new URLSearchParams(query);
  const res = await fetch(`/api/customers?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách khách hàng');
  return CustomerList.parse(await res.json());
}

/* ── P-41 · Tạo / sửa ─────────────────────────────────────────────────── */

export const CustomerPhoneForm = z.object({
  number: z
    .string()
    .trim()
    .regex(/^0\d{9}$/, 'Số điện thoại phải đủ 10 số và bắt đầu bằng 0'),
  primary: z.boolean(),
});
export type CustomerPhoneForm = z.infer<typeof CustomerPhoneForm>;

/**
 * Tên không ràng buộc định dạng (spec §4.4 P-41) — nhân viên gõ sao lưu vậy.
 * CCCD để trống được — module B chưa chắc bắt buộc; có nhập thì phải đủ 12 số.
 */
export const CustomerForm = z.object({
  fullName: z.string().trim().min(1, 'Chưa nhập họ tên'),
  dob: z.string(),
  idNumber: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{12}$/.test(v), 'CCCD phải đủ 12 số'),
  address: z.string().trim(),
  phones: z.array(CustomerPhoneForm).min(1, 'Cần ít nhất một số điện thoại'),
  channel: z.string(),
  channelDetail: z.string(),
});
export type CustomerForm = z.infer<typeof CustomerForm>;

export const CUSTOMER_ERROR = {
  DUPLICATE_ID: 'duplicate-id-number',
} as const;

/** Không phải lỗi ngõ cụt — kèm theo hồ sơ đã có để dùng lại ngay (spec §2.1). */
export const DuplicateCustomerError = z.object({
  code: z.literal(CUSTOMER_ERROR.DUPLICATE_ID),
  message: z.string(),
  existing: z.object({
    id: z.string(),
    fullName: z.string(),
    primaryPhone: z.string(),
    accountCount: z.number(),
    insuranceCount: z.number(),
  }),
});
export type DuplicateCustomerError = z.infer<typeof DuplicateCustomerError>;

export const isDuplicateCustomerError = (e: unknown): e is DuplicateCustomerError =>
  typeof e === 'object' && e !== null && 'code' in e;

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = DuplicateCustomerError.safeParse(await res.json().catch(() => null));
    throw parsed.success ? parsed.data : new Error('Không lưu được');
  }
  return res.json();
}

export const createCustomer = (form: CustomerForm) =>
  send('/api/customers', 'POST', form).then(Customer.parse);

export const updateCustomer = (id: string, form: CustomerForm) =>
  send(`/api/customers/${id}`, 'PATCH', form).then(Customer.parse);

/* ── P-42 · Hồ sơ 360° ────────────────────────────────────────────────── */

export const CustomerAccountRow = z.object({
  id: z.string(),
  date: z.string(),
  bankName: z.string(),
  referralCode: z.string(),
  appInstalled: z.boolean(),
});
export type CustomerAccountRow = z.infer<typeof CustomerAccountRow>;

/**
 * Tài khoản đang `creating` (spec §4.5) — đã giữ chỗ mã, KD đi mở tài khoản
 * thật bên ngoài, chưa quay lại điền nốt. Tách khỏi `CustomerAccountRow` vì
 * chưa có ngày mở/đã cài app thật — chỉ đủ dữ liệu để "Tiếp tục" hoặc "Xoá".
 */
export const CustomerDraftAccountRow = z.object({
  id: z.string(),
  bankName: z.string(),
  referralCode: z.string(),
});
export type CustomerDraftAccountRow = z.infer<typeof CustomerDraftAccountRow>;

export const CustomerInsuranceRow = z.object({
  id: z.string(),
  date: z.string(),
  product: z.string(),
  packageName: z.string(),
  status: InsuranceOrderStatus,
  /** Đơn tự khách mua, hay từ luồng tặng quà (P-43 — chưa làm nên luôn 'self'). */
  source: z.enum(['self', 'gift']),
});
export type CustomerInsuranceRow = z.infer<typeof CustomerInsuranceRow>;

export const CustomerDetail = z.object({
  customer: Customer,
  accounts: z.array(CustomerAccountRow),
  /** Tài khoản đang tạo dở, chưa hoàn thành — cùng áp phạm vi như `accounts`. */
  draftAccounts: z.array(CustomerDraftAccountRow),
  draftAccountsHiddenCount: z.number(),
  /** Số bản ghi ngoài phạm vi người xem — hiện gộp, không hiện chi tiết. */
  accountsHiddenCount: z.number(),
  insurance: z.array(CustomerInsuranceRow),
  insuranceHiddenCount: z.number(),
  /**
   * Quà tính trên TOÀN BỘ tài khoản của khách, không chỉ phần người xem thấy
   * được (spec §4.4 P-42 lỗi thường gặp #2) — dùng chung máy tính với P-81.
   */
  gift: GiftSimulateResult.extend({
    given: z.boolean(),
    /** Tên món đã tặng — chỉ có giá trị khi given = true. */
    givenItem: z.string().nullable(),
  }),
});
export type CustomerDetail = z.infer<typeof CustomerDetail>;

export async function fetchCustomerDetail(id: string, actorId: string): Promise<CustomerDetail> {
  const params = new URLSearchParams({ actorId });
  const res = await fetch(`/api/customers/${id}?${params}`);
  if (res.status === 404) throw new Error('Không tìm thấy khách hàng này');
  if (!res.ok) throw new Error('Không tải được hồ sơ khách hàng');
  return CustomerDetail.parse(await res.json());
}

/**
 * Đánh dấu khách đã được tặng quà — đúng một lần, không có đợt thứ hai
 * (spec §4.4 P-43). `item` là tên món đã chọn, hoặc câu mô tả việc từ chối.
 */
export async function markGiftGiven(customerId: string, item: string): Promise<void> {
  const res = await fetch(`/api/customers/${customerId}/gift-given`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item }),
  });
  if (!res.ok) throw new Error('Không đánh dấu được quà đã tặng');
}

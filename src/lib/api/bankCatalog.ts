import { z } from 'zod';

/**
 * P-60 · Kho ngân hàng · P-61 · Kho mã giới thiệu (mgst-feature-list.md §4.6).
 *
 * Danh sách ngân hàng là DANH SÁCH PHẲNG thật, không phải danh mục tự do:
 * `MB · VPa · VPb · LBP · MSBa · MSBb · TCB · BIDV · TPB · VIB · SHB` + `CNKD`
 * · `HKD` (mgst-platform-spec.md §2.6, dòng 466-468). VPa/VPb và MSBa/MSBb
 * cùng một nhà băng ngoài đời nhưng khác mã giới thiệu, khác hệ số điểm,
 * khác chính sách — bốn ngân hàng riêng biệt, không gộp cha–con.
 */

export const AccountNumberMethod = z.enum(['phone-match', 'manual']);
export type AccountNumberMethod = z.infer<typeof AccountNumberMethod>;

export const ACCOUNT_NUMBER_METHOD_LABEL: Record<AccountNumberMethod, string> = {
  'phone-match': 'Trùng SĐT',
  manual: 'Nhập tay',
};

export const Bank = z.object({
  id: z.string(),
  code: z.string(),
  /** Đang triển khai — tắt thì không hiện cho KD chọn lúc tạo mới. */
  active: z.boolean(),
  requiredPhotos: z.number(),
  accountNumberMethod: AccountNumberMethod,
  /** Hệ số điểm KPI — mặc định 1, riêng VPb = 1.4 (đã biết). */
  coefficient: z.number(),
  /** false với CNKD/HKD — tính điểm nhưng không cộng vào tổng app xét quà. */
  countsAsApp: z.boolean(),
});
export type Bank = z.infer<typeof Bank>;

export const BankForm = z.object({
  code: z.string().trim().min(1, 'Chưa nhập mã ngân hàng'),
  requiredPhotos: z.number().min(0, 'Số ảnh phải từ 0 trở lên'),
  accountNumberMethod: AccountNumberMethod,
  coefficient: z.number().min(0, 'Hệ số phải từ 0 trở lên'),
  countsAsApp: z.boolean(),
});
export type BankForm = z.infer<typeof BankForm>;

export async function fetchBanks(): Promise<Bank[]> {
  const res = await fetch('/api/settings/banks');
  if (!res.ok) throw new Error('Không tải được danh sách ngân hàng');
  return z.array(Bank).parse(await res.json());
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Không lưu được');
  return res.json();
}

export const createBank = (form: BankForm) =>
  send('/api/settings/banks', 'POST', form).then(Bank.parse);

export const updateBank = (id: string, form: BankForm) =>
  send(`/api/settings/banks/${id}`, 'PATCH', form).then(Bank.parse);

export const setBankActive = (id: string, active: boolean) =>
  send(`/api/settings/banks/${id}/active`, 'POST', { active }).then(Bank.parse);

/* ── P-61 · Kho mã giới thiệu — chỉ xem, tạo/nhập hàng loạt thuộc P-62 ──── */

export const ReferralCode = z.object({
  id: z.string(),
  bankId: z.string(),
  code: z.string(),
  used: z.number(),
  total: z.number(),
  holding: z.number(),
});
export type ReferralCode = z.infer<typeof ReferralCode>;

export const CodeStatus = z.enum(['available', 'low', 'full']);
export type CodeStatus = z.infer<typeof CodeStatus>;

export const CODE_STATUS_LABEL: Record<CodeStatus, string> = {
  available: 'Còn chỗ',
  low: 'Sắp hết',
  full: 'Đã đầy',
};

/** Sắp hết khi đã dùng từ 80% trở lên — ngưỡng cảnh báo trước khi đầy hẳn. */
export function codeStatusOf(c: ReferralCode): CodeStatus {
  if (c.used >= c.total) return 'full';
  if (c.used / c.total >= 0.8) return 'low';
  return 'available';
}

export type ReferralCodeQuery = {
  bankId: string;
  status: CodeStatus | '';
};

export async function fetchReferralCodes(query: ReferralCodeQuery): Promise<ReferralCode[]> {
  const params = new URLSearchParams({ bankId: query.bankId, status: query.status });
  const res = await fetch(`/api/settings/referral-codes?${params}`);
  if (!res.ok) throw new Error('Không tải được kho mã giới thiệu');
  return z.array(ReferralCode).parse(await res.json());
}

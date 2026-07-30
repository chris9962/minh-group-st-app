import { z } from 'zod';

/**
 * P-20 · Tạo tài khoản ngân hàng (mgst-platform-spec.md §4).
 *
 * Hệ thống KHÔNG mở tài khoản — chỉ ghi nhận: khách nào, ngân hàng nào, mã
 * giới thiệu nào, đã cài app chưa, ảnh chứng minh. Một tài khoản = một bản ghi.
 *
 * Dựng để DÙNG LẠI: hộp thoại này mở từ P-42 (hồ sơ khách) hôm nay, và sẽ mở
 * lại y hệt từ P-20/màn Ngân hàng khi màn đó được xây — không đổi API.
 */

export const AccountType = z.enum(['none', 'CNKD', 'HKD']);
export type AccountType = z.infer<typeof AccountType>;

export const BankAccount = z.object({
  id: z.string(),
  customerId: z.string(),
  /** Trùng lặp có chủ ý — mọi bản ghi tài khoản trong app đều lưu kèm tên
   *  khách, không chỉ id (khớp PersonAccount ở lib/api/person.ts). */
  customerName: z.string(),
  bankId: z.string(),
  bankCode: z.string(),
  referralCode: z.string(),
  accountNumber: z.string(),
  openedDate: z.string(),
  /** '' = không có kênh. */
  channel: z.string(),
  channelDetail: z.string(),
  appInstalled: z.boolean(),
  /** Chỉ có ý nghĩa khi ngân hàng = VPa. */
  accountType: AccountType,
  note: z.string(),
  /** Phòng của người tạo lúc tạo — dùng để lọc theo phạm vi ở P-42. */
  createdByDepartmentId: z.string().nullable(),
});
export type BankAccount = z.infer<typeof BankAccount>;

export const BankAccountForm = z.object({
  customerId: z.string(),
  bankId: z.string().trim().min(1, 'Chưa chọn ngân hàng'),
  referralCode: z.string().trim().min(1, 'Chưa chọn mã giới thiệu'),
  accountNumber: z.string().trim().min(1, 'Chưa có số tài khoản'),
  openedDate: z.string().trim().min(1, 'Chưa chọn ngày mở'),
  channel: z.string(),
  channelDetail: z.string(),
  appInstalled: z.boolean(),
  accountType: AccountType,
  /** Chặn cứng nếu chưa tích — số ảnh bắt buộc lấy từ cấu hình ngân hàng (P-60). */
  photosConfirmed: z.boolean().refine((v) => v, 'Chưa đủ ảnh chứng minh theo cấu hình'),
  note: z.string(),
});
export type BankAccountForm = z.infer<typeof BankAccountForm>;

export const CreateBankAccountResult = z.object({
  account: BankAccount,
  /**
   * Cảnh báo mềm — đếm trên TOÀN BỘ tài khoản của khách, không chặn lưu
   * (spec §4.8). Người dùng vẫn đã lưu xong khi thấy các dòng này.
   */
  warnings: z.array(z.string()),
});
export type CreateBankAccountResult = z.infer<typeof CreateBankAccountResult>;

export async function createBankAccount(
  form: BankAccountForm,
  actorId: string,
): Promise<CreateBankAccountResult> {
  const res = await fetch('/api/bank-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...form, actorId }),
  });
  if (!res.ok) throw new Error('Không lưu được tài khoản này');
  return CreateBankAccountResult.parse(await res.json());
}

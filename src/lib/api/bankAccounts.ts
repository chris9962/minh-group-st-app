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

/**
 * TODO(P-20 Ngân hàng, chờ module ngân hàng): MỌI hàm trong file này gọi vào
 * `/api/bank-accounts*`, mà route đó CHƯA TỒN TẠI — gọi vào là 404.
 *
 * Hộp thoại `BankAccountFormDialog` mở được từ P-40/P-42 và điền được hết, chỉ
 * bấm lưu là hỏng. Nút mở nó nằm ở `app/(app)/customers/page.tsx` và
 * `app/(app)/customers/[id]/page.tsx`. Gỡ mốc ở cả hai đầu khi dựng route.
 */

export const AccountType = z.enum(['none', 'CNKD', 'HKD']);
export type AccountType = z.infer<typeof AccountType>;

/**
 * Hai bước, không phải một (spec §4.5): KD chọn ngân hàng + mã rồi đi mở tài
 * khoản THẬT bên ngoài (có thể mất nhiều giờ, qua ngày khác) — không nhập hết
 * một lần được. `creating` = đã giữ chỗ mã, đang chờ quay lại điền nốt.
 * `done` = đã quay lại, đủ ảnh chứng minh, mã đã tiêu thật.
 *
 * "Đang giữ" của một mã giới thiệu = số tài khoản `creating` tham chiếu mã đó,
 * đếm sẵn ở `referral_codes.holding_count`. Chỗ được nhả bằng đúng một đường:
 * xoá dòng `creating`.
 */
export const BankAccountStatus = z.enum(['creating', 'done']);
export type BankAccountStatus = z.infer<typeof BankAccountStatus>;

export const BankAccount = z.object({
  id: z.string(),
  customerId: z.string(),
  /** Trùng lặp có chủ ý — mọi bản ghi tài khoản trong app đều lưu kèm tên
   *  khách, không chỉ id (khớp PersonAccount ở lib/api/person.ts). */
  customerName: z.string(),
  bankId: z.string(),
  bankCode: z.string(),
  /** Id thật của mã — dùng để đối chiếu/tiêu mã. `referralCode` là chuỗi hiển thị. */
  referralCodeId: z.string(),
  referralCode: z.string(),
  /** '' lúc còn `creating` — chưa chắc đã biết số thật cho tới khi mở xong. */
  accountNumber: z.string(),
  openedDate: z.string(),
  /** Chép lại từ khách lúc mở tài khoản — kênh thuộc về khách, không nhập ở đây. */
  channel: z.string(),
  channelDetail: z.string(),
  appInstalled: z.boolean(),
  /** Chỉ có ý nghĩa khi ngân hàng = VPa. */
  accountType: AccountType,
  note: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  /** Phòng của người tạo lúc tạo — dùng để lọc theo phạm vi ở P-42, P-21. */
  createdByDepartmentId: z.string().nullable(),
  /** Ảnh chứng minh thật — số ảnh bắt buộc lấy từ cấu hình ngân hàng (P-60), xem/sửa ở P-22. */
  photoUrls: z.array(z.string()),
  status: BankAccountStatus,
});
export type BankAccount = z.infer<typeof BankAccount>;

/** Bước 1 (P-20) — chỉ chọn ngân hàng + mã. Lưu là giữ chỗ mã ngay, tạo dòng `creating`. */
export const BankAccountStartForm = z.object({
  customerId: z.string(),
  bankId: z.string().trim().min(1, 'Chưa chọn ngân hàng'),
  referralCode: z.string().trim().min(1, 'Chưa chọn mã giới thiệu'),
});
export type BankAccountStartForm = z.infer<typeof BankAccountStartForm>;

/** Bước 2 (P-22, khi tài khoản đang `creating`) — điền nốt sau khi đã mở xong ở ngoài. */
export const BankAccountFinishForm = z.object({
  accountNumber: z.string().trim().min(1, 'Chưa có số tài khoản'),
  openedDate: z.string().trim().min(1, 'Chưa chọn ngày mở'),
  appInstalled: z.boolean(),
  accountType: AccountType,
  note: z.string(),
});
export type BankAccountFinishForm = z.infer<typeof BankAccountFinishForm>;

export const CreateBankAccountResult = z.object({
  account: BankAccount,
  /**
   * Cảnh báo mềm — đếm trên TOÀN BỘ tài khoản của khách, không chặn lưu
   * (spec §4.8). Người dùng vẫn đã lưu xong khi thấy các dòng này.
   */
  warnings: z.array(z.string()),
});
export type CreateBankAccountResult = z.infer<typeof CreateBankAccountResult>;

/** Bước 1 — giữ chỗ mã, tạo dòng `creating`. Chưa có cảnh báo vì chưa biết đã cài app chưa. */
export async function startBankAccount(
  form: BankAccountStartForm,
  actorId: string,
): Promise<BankAccount> {
  const res = await fetch('/api/bank-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...form, actorId }),
  });
  if (!res.ok) throw new Error('Không giữ được chỗ mã này');
  return BankAccount.parse(await res.json());
}

/** Bước 2 — điền nốt + đủ ảnh mới cho hoàn thành; lúc này mã mới thật sự bị tiêu. */
export async function finishBankAccount(
  id: string,
  form: BankAccountFinishForm,
  actorId: string,
): Promise<CreateBankAccountResult> {
  const res = await fetch(`/api/bank-accounts/${id}/finish`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...form, actorId }),
  });
  if (!res.ok) throw new Error('Không hoàn thành được tài khoản này');
  return CreateBankAccountResult.parse(await res.json());
}

/** Bỏ dở — chỉ xoá được khi còn `creating`. Nhả mã lại kho ngay (mục 4.5). */
export async function deleteBankAccount(id: string, actorId: string): Promise<void> {
  const params = new URLSearchParams({ actorId });
  const res = await fetch(`/api/bank-accounts/${id}?${params}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Không xoá được tài khoản đang tạo này');
}

/** Thêm/thay/xoá ảnh chứng minh ở P-22 — gửi nguyên mảng đã cập nhật. */
export async function setBankAccountPhotos(
  id: string,
  photoUrls: string[],
  actorId: string,
): Promise<BankAccount> {
  const res = await fetch(`/api/bank-accounts/${id}/photos`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoUrls, actorId }),
  });
  if (!res.ok) throw new Error('Không lưu được ảnh chứng minh này');
  return BankAccount.parse(await res.json());
}

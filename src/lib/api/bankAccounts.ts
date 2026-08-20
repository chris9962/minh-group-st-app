import { z } from 'zod';
import { isoDate, isoDateOrEmpty } from '@/lib/types';

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
  /**
   * Link mở tài khoản của mã này, giải từ ảnh QR ở P-61 (spec §4.4b).
   * `''` = mã không có link; bước 2 khi đó không dựng nút mở app ngân hàng.
   */
  referralOpenUrl: z.string(),
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
  /** `''` = chưa ghi nhận giao dịch nào (bước 3, spec §4.2). */
  transactionAt: z.string(),
  /** Ảnh chuyển khoản — đếm RIÊNG, không cộng vào `photoUrls`. */
  transactionPhotoUrls: z.array(z.string()),
  /**
   * Mọi SĐT của khách, số chính đứng đầu. Ngân hàng lấy số tài khoản theo SĐT
   * thì bước 2 cho chọn trong danh sách này — khách mở bằng số phụ là chuyện
   * thường, áp cứng số chính là ghi sai số tài khoản vào hợp đồng.
   */
  customerPhones: z.array(z.string()),
  status: BankAccountStatus,
});
export type BankAccount = z.infer<typeof BankAccount>;

/** Bước 1 (P-20) — chỉ chọn ngân hàng + mã. Lưu là giữ chỗ mã ngay, tạo dòng `creating`. */
export const BankAccountStartForm = z.object({
  // Bắt dạng uuid ngay ở đây: để lọt chuỗi bậy xuống Postgres là `22P02`, mà
  // tầng dưới chỉ bắt lỗi trùng khoá nên client nhận 500 thay vì 400.
  customerId: z.uuid('Chưa chọn khách'),
  bankId: z.uuid('Chưa chọn ngân hàng'),
  referralCode: z.uuid('Chưa chọn mã giới thiệu'),
  /**
   * Phòng ghi nhận bản ghi này. Chỉ người KHÔNG thuộc phòng nào mới phải chọn —
   * người có phòng thì máy chủ dùng phòng của họ và bỏ qua giá trị này.
   */
  departmentId: z.string(),
});
export type BankAccountStartForm = z.infer<typeof BankAccountStartForm>;

/** Bước 2 (P-22, khi tài khoản đang `creating`) — điền nốt sau khi đã mở xong ở ngoài. */
export const BankAccountFinishForm = z.object({
  accountNumber: z.string().trim().min(1, 'Chưa có số tài khoản'),
  /**
   * Bắt đúng `YYYY-MM-DD`, và phải là ngày CÓ THẬT.
   *
   * Postgres nhận nhiều dạng ngày mà `Date` của JS không nhận. Gửi `20260806`
   * thì câu `UPDATE` THÀNH CÔNG — tài khoản lên `done`, mã đã tiêu — rồi
   * `businessMonth(new Date(…))` ném lỗi và route trả 500: dữ liệu đã ghi, điểm
   * KPI không được tính lại, nhật ký truy vết không có dòng nào.
   *
   * Đúng hình dạng vẫn chưa đủ: `2026-02-31` khớp regex mà Postgres từ chối
   * bằng `22008`, và người dùng nhận 500 thay vì câu báo lỗi.
   */
  openedDate: isoDate('Chưa chọn ngày mở'),
  appInstalled: z.boolean(),
  accountType: AccountType,
  note: z.string(),
});
export type BankAccountFinishForm = z.infer<typeof BankAccountFinishForm>;

/**
 * Bước 2 + bước 3 gộp lại — biểu mẫu SỬA một tài khoản đã `done` (P-22).
 *
 * Ngày giao dịch chỉ có mặt ở đây, không có ở `BankAccountFinishForm`: bước 2
 * là lúc vừa mở tài khoản xong, chưa thể có giao dịch để ghi. Ghi nhận giao
 * dịch là việc quay lại làm sau (spec §4.2 bước 3).
 */
export const BankAccountUpdateForm = BankAccountFinishForm.extend({
  /** `''` = chưa ghi nhận. Trùng ngày mở vẫn hợp lệ (chốt 07/08). */
  transactionAt: isoDateOrEmpty,
});
export type BankAccountUpdateForm = z.infer<typeof BankAccountUpdateForm>;

export const CreateBankAccountResult = z.object({
  account: BankAccount,
  /**
   * Cảnh báo mềm — đếm trên TOÀN BỘ tài khoản của khách, không chặn lưu
   * (spec §4.8). Người dùng vẫn đã lưu xong khi thấy các dòng này.
   */
  warnings: z.array(z.string()),
});
export type CreateBankAccountResult = z.infer<typeof CreateBankAccountResult>;

/**
 * Máy chủ đã nói rõ vì sao ("Mã này vừa hết chỗ") — nuốt đi rồi ném câu chung
 * chung là bắt người dùng tự đoán mình sai chỗ nào.
 */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message?.trim() || fallback);
}

/**
 * Bước 1 — giữ chỗ mã, tạo dòng `creating`.
 *
 * Người tạo do máy chủ lấy từ phiên đăng nhập, biểu mẫu không gửi: nhận
 * `actorId` từ client là mở đường ghi công của mình vào tên người khác.
 *
 * Hai người bấm cùng lúc vào chỗ cuối thì chỉ một người được — người kia nhận
 * lỗi "hết chỗ" NGAY tại đây, không phải đợi tới bước 2 mới biết đã mất công
 * đi mở tài khoản (spec §4.5).
 */
export async function startBankAccount(form: BankAccountStartForm): Promise<BankAccount> {
  const res = await fetch('/api/bank-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không giữ được chỗ mã này');
  return BankAccount.parse(await res.json());
}

/** Bước 2 — điền nốt + đủ ảnh mới cho hoàn thành; lúc này mã mới thật sự bị tiêu. */
export async function finishBankAccount(
  id: string,
  form: BankAccountFinishForm,
): Promise<CreateBankAccountResult> {
  const res = await fetch(`/api/bank-accounts/${id}/finish`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không hoàn thành được tài khoản này');
  return CreateBankAccountResult.parse(await res.json());
}

/**
 * Sửa một tài khoản ĐÃ hoàn thành (chốt 07/08) — cùng bộ ô với bước 2.
 *
 * Khác `finishBankAccount` ở chỗ nó KHÔNG đụng kho mã: mã đã tiêu từ lúc hoàn
 * thành và giữ nguyên. Khách, ngân hàng, mã giới thiệu không sửa được ở đây.
 *
 * ⚠️ Đổi ngày mở là đổi tháng tính điểm — máy chủ tính lại cả tháng cũ lẫn
 * tháng mới, nên nơi gọi phải làm mới ba màn hiện điểm (`invalidateKpi`).
 */
export async function updateBankAccount(
  id: string,
  form: BankAccountUpdateForm,
): Promise<CreateBankAccountResult> {
  const res = await fetch(`/api/bank-accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được thay đổi cho tài khoản này');
  return CreateBankAccountResult.parse(await res.json());
}

/** Bỏ dở — chỉ xoá được khi còn `creating`. Nhả mã lại kho ngay (mục 4.5). */
export async function deleteBankAccount(id: string): Promise<void> {
  const res = await fetch(`/api/bank-accounts/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Không xoá được tài khoản đang tạo này');
}

/** Hai loại ảnh của một tài khoản, đếm tách nhau (spec §4.2 bước 3). */
export type PhotoKind = 'opening' | 'transaction';

/**
 * Trần số ảnh MỖI NHÓM. Máy chủ chặn theo đúng con số này, giao diện cũng khoá
 * theo — hai nơi lệch nhau thì người dùng chọn đủ ảnh rồi mới nhận lỗi 400.
 */
export const PHOTO_MAX = 20;

const PHOTO_LABEL: Record<PhotoKind, string> = {
  opening: 'ảnh chứng minh',
  transaction: 'ảnh giao dịch',
};

/**
 * Ghi danh sách ảnh vào database — gửi nguyên mảng URL đã cập nhật.
 *
 * KHÔNG nhận file: tải ảnh lên là việc riêng của `uploadImage`, đường này chỉ
 * ghi URL. Tách hai việc ra để một lần tải hỏng không kéo theo cả bản ghi, và
 * để đổi chỗ lưu trữ về sau không phải sửa nghiệp vụ.
 *
 * `kind` quyết định ghi đè NHÓM NÀO. Ảnh giao dịch nộp muộn hơn ảnh chứng minh
 * rất nhiều, nên hai nhóm phải ghi rời — gửi chung một mảng là lượt nộp ảnh
 * giao dịch xoá sạch ảnh chứng minh của bước 2.
 */
export async function setBankAccountPhotos(
  id: string,
  photoUrls: string[],
  kind: PhotoKind = 'opening',
): Promise<BankAccount> {
  const res = await fetch(`/api/bank-accounts/${id}/photos`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoUrls, kind }),
  });
  if (!res.ok) throw await failure(res, `Không lưu được ${PHOTO_LABEL[kind]} này`);
  return BankAccount.parse(await res.json());
}

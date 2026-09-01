import { z } from 'zod';
import { businessDay } from '@/lib/format';
import { isoDate, isoDateOrEmpty, ROLE_RANK, type User } from '@/lib/types';

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
export const BankAccountStatus = z.enum(['creating', 'done', 'error']);
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
  /** Dữ liệu link cũ để tương thích; giao diện không dùng để mở app. */
  referralOpenUrl: z.string(),
  /** URL ảnh QR; `''` = mã text-only và bước 2 không dựng nút QR. */
  referralQrUrl: z.string(),
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
  /** Lý do đối soát đánh dấu lỗi; chỉ có giá trị khi status = error. */
  errorNote: z.string(),
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

/** Trần số tài khoản ngân hàng của MỘT khách (chốt 2026-08-25). */
export const MAX_BANK_ACCOUNTS_PER_CUSTOMER = 3;

/**
 * MỘT ngân hàng khách chọn mở, kèm mã giữ chỗ cho nó.
 *
 * `guid` chứ KHÔNG phải `uuid`: `z.uuid()` bắt đúng chuẩn RFC 9562, tức soi hai
 * ô version và variant. Postgres không soi hai ô đó, và `isUuid` ở
 * `server/auth.ts` cũng không — nên id do database chấp nhận lại bị biểu mẫu
 * từ chối.
 *
 * Không phải ca giả định: `scripts/db-load-t8.sql` sinh id bằng
 * `md5('t8:' || stt)::uuid`, và 33.023 trong 37.791 hồ sơ khách rơi ra ngoài
 * chuẩn RFC. Chọn một khách như vậy rồi bấm Tạo thì biểu mẫu báo thiếu ô mà
 * không ô nào tô đỏ — ô hỏng là `customerId`, vốn không có giao diện.
 */
export const BankAccountPick = z.object({
  bankId: z.guid('Chưa chọn ngân hàng'),
  referralCode: z.guid('Chưa chọn mã giới thiệu'),
  /** Chốt cùng mã ở bước giữ chỗ, không chọn lại khi hoàn tất tài khoản. */
  accountType: AccountType,
});
export type BankAccountPick = z.infer<typeof BankAccountPick>;

/**
 * Bước GIỮ CHỖ (P-20) — chọn 1–3 ngân hàng trong MỘT lượt, mỗi ngân hàng một mã.
 *
 * Một lượt lưu sinh bấy nhiêu dòng `creating`. Điền nốt số tài khoản, ngày mở và
 * ảnh là việc riêng của TỪNG dòng, làm ở bảng P-21 hoặc màn P-22 — không nhét ba
 * bộ ô đó vào cùng hộp thoại này, vì nhân viên vẫn phải mở app ngân hàng thật ba
 * lần và ba lượt đó cách nhau hàng giờ.
 */
export const BankAccountStartForm = z
  .object({
    customerId: z.guid('Chưa chọn khách'),
    picks: z
      .array(BankAccountPick)
      .min(1, 'Chưa chọn ngân hàng nào')
      .max(
        MAX_BANK_ACCOUNTS_PER_CUSTOMER,
        `Một khách mở tối đa ${MAX_BANK_ACCOUNTS_PER_CUSTOMER} tài khoản`,
      ),
    /**
     * Phòng ghi nhận bản ghi này. Chỉ người KHÔNG thuộc phòng nào mới phải chọn —
     * người có phòng thì máy chủ dùng phòng của họ và bỏ qua giá trị này.
     */
    departmentId: z.string(),
  })
  // Giao diện không cho tích một ngân hàng hai lần, nhưng đây là chỗ chốt: khoá
  // duy nhất `(customer_id, bank_id)` sẽ từ chối, và lỗi khoá đọc ra như 500.
  .refine((form) => new Set(form.picks.map((p) => p.bankId)).size === form.picks.length, {
    message: 'Một ngân hàng chỉ chọn được một lần',
    path: ['picks'],
  });
export type BankAccountStartForm = z.infer<typeof BankAccountStartForm>;

/**
 * Chỗ mở tài khoản còn lại của một khách — dùng để lọc ô chọn ngân hàng ở bước
 * 1 P-20, trước khi người dùng mất công chọn mã rồi mới bị máy chủ từ chối.
 *
 * Đếm trên TOÀN BỘ tài khoản của khách, kể cả dòng ngoài phạm vi người xem và
 * kể cả dòng `creating`: trần áp cho KHÁCH, không áp cho người đang xem. Hồ sơ
 * khách (P-42) đã tính quà theo cùng lối đó (spec §4.4).
 */
export const CustomerBankSlots = z.object({
  usedBankIds: z.array(z.string()),
  /** Ngân hàng khách đủ tuổi mở; ngân hàng không giới hạn tuổi luôn có mặt. */
  eligibleBankIds: z.array(z.string()),
  /** Số tài khoản còn mở thêm được, 0 là đã đủ trần. */
  remaining: z.number(),
});
export type CustomerBankSlots = z.infer<typeof CustomerBankSlots>;

export async function fetchCustomerBankSlots(customerId: string): Promise<CustomerBankSlots> {
  const res = await fetch(`/api/customers/${customerId}/bank-slots`);
  if (!res.ok) throw await failure(res, 'Không đọc được số tài khoản của khách này');
  return CustomerBankSlots.parse(await res.json());
}

/** Bước 2 (P-22, khi tài khoản đang `creating`) — điền nốt sau khi đã mở xong ở ngoài. */
export const BankAccountFinishForm = z.object({
  accountNumber: z.string().trim().min(1, 'Chưa có số tài khoản'),
  /**
   * Bắt đúng `YYYY-MM-DD`, và phải là ngày CÓ THẬT.
   *
   * Postgres nhận nhiều dạng ngày mà `Date` của JS không nhận. Gửi `20260806`
   * thì câu `UPDATE` THÀNH CÔNG — tài khoản lên `done`, mã đã tiêu — rồi
   * `businessMonth(new Date(…))` ném lỗi và route trả 500: dữ liệu đã ghi, điểm
   * KPI không được tính lại, nhật ký hoạt động không có dòng nào.
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

/** Đối soát trạng thái tài khoản đã hoàn thành. Tài khoản lỗi bị loại khỏi KPI. */
export const BankAccountStatusUpdateForm = z
  .object({
    status: z.enum(['done', 'error']),
    errorNote: z.string().trim().max(500, 'Lý do nhiều nhất 500 ký tự'),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'error' && value.errorNote.length < 2)
      ctx.addIssue({ code: 'custom', path: ['errorNote'], message: 'Nhập lý do đánh dấu lỗi' });
  });
export type BankAccountStatusUpdateForm = z.infer<typeof BankAccountStatusUpdateForm>;

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
export async function startBankAccount(form: BankAccountStartForm): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không giữ được chỗ mã này');
  return z.array(BankAccount).parse(await res.json());
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

/** Đối soát ngược: đổi Done ↔ Lỗi, kèm lý do khi loại tài khoản khỏi KPI. */
export async function updateBankAccountStatus(
  id: string,
  form: BankAccountStatusUpdateForm,
): Promise<BankAccount> {
  const res = await fetch(`/api/bank-accounts/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không đổi được trạng thái tài khoản');
  return BankAccount.parse(await res.json());
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

/**
 * Ảnh chứng minh của tài khoản ĐÃ HOÀN THÀNH còn sửa được không (chốt 2026-08-23).
 *
 * Cửa sổ là NGÀY LỊCH của lúc bấm Hoàn thành, giờ VN — không phải 24 giờ trôi:
 * nhân viên nhìn lịch để biết còn kịp hay không, chứ không nhẩm giờ. Hết ngày
 * là ảnh chốt lại, vì bản ghi lúc đó đã tiêu một lượt mã và đã vào điểm KPI.
 *
 * Từ Trưởng phòng trở lên không bị hạn này — hết ngày rồi thì không còn đường
 * chữa nào khác, bản `done` cũng không xoá được.
 *
 * `finishedAt = ''` là bản ghi cũ có trước khi cột này được ghi: coi như hết
 * hạn, không đoán ngày thay người dùng.
 *
 * Ảnh giao dịch KHÔNG dính luật này — nó là bằng chứng nộp muộn (spec §4.2
 * bước 3), hôm sau mới có.
 */
export const canEditOpeningPhotos = (
  actor: User | null,
  account: { status: BankAccountStatus; finishedAt: string },
): boolean => {
  if (!actor) return false;
  if (account.status === 'creating') return true;
  if (ROLE_RANK[actor.role] >= ROLE_RANK.head) return true;
  return account.finishedAt !== '' && businessDay(new Date(account.finishedAt)) === businessDay();
};

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

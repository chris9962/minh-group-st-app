import { z } from 'zod';
import { AccountType } from './bankAccounts';
import { INT_MAX, SMALLINT_MAX } from './limits';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-60 · Kho ngân hàng · P-61 · Kho mã giới thiệu (mgst-feature-list.md §4.6).
 *
 * Danh sách ngân hàng là DANH SÁCH PHẲNG thật, không phải danh mục tự do:
 * `MB · VPa · VPb · LPB · MSBa · MSBb · TCB · BIDV · TPB · VIB · SHB` + `CNKD`
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

/**
 * Chuỗi ảnh do chính `/api/uploads` trả về; `''` = không có ảnh.
 *
 * Ở đây chỉ kiểm phần ĐẦU chuỗi. Chốt thật nằm ở máy chủ: `imageKeyOf`
 * (`server/storage.ts`) khớp trọn hình dạng khoá rồi mới ghi, chuỗi nào không
 * khớp thì lưu về thành không có ảnh. Chép nguyên mẫu khoá xuống đây là hai bản
 * luật cho một việc, và chúng lệch nhau ngay lần đổi kho ảnh đầu tiên.
 */
export const ImageRef = z
  .string()
  .trim()
  .refine((v) => v === '' || v.startsWith('/api/images/'), 'Ảnh không hợp lệ');

/** Tên cũ, giữ cho hộp thoại mã giới thiệu khỏi phải đổi theo. */
export const QrImageRef = ImageRef;

export const Bank = z.object({
  id: z.string(),
  /** `''` khi mã này chỉ có ảnh QR. */
  code: z.string(),
  /** Đang triển khai — tắt thì không hiện cho KD chọn lúc tạo mới. */
  active: z.boolean(),
  requiredPhotos: z.number(),
  accountNumberMethod: AccountNumberMethod,
  /**
   * Hệ số điểm KPI cũ. HẾT TÁC DỤNG từ 03/08 — điểm giờ tính theo tổ hợp combo
   * của từng khách trong `src/rules/YYYY-MM.ts`, không cộng hệ số từng ngân
   * hàng (`mgst-db-design.md`:458).
   *
   * Cột vẫn còn trong DB nên vẫn trả về, nhưng KHÔNG hiện ở bảng và KHÔNG có ô
   * nhập: mở cho sửa là mời người ta kéo một cần gạt mà nghiệp vụ đã bỏ, và
   * chừng nào công thức tạm còn đọc nó thì điểm KPI đổi thật mà không ai báo.
   */
  coefficient: z.number(),
  /** false với CNKD/HKD — tính điểm nhưng không cộng vào tổng app xét quà. */
  countsAsApp: z.boolean(),
  /** Số lớn lên đầu ô chọn ngân hàng lúc mở tài khoản. 0 là mức thường. */
  priority: z.number(),
  /** null = không giới hạn độ tuổi phía dưới. */
  minAge: z.number().nullable(),
  /** null = không giới hạn độ tuổi phía trên. */
  maxAge: z.number().nullable(),
  /**
   * Nhân viên được giao quản ngân hàng này (chốt 2026-08-24).
   *
   * Rỗng = chưa giao cho ai, và ngân hàng vẫn chạy bình thường — người ở phạm
   * vi `all` sửa được nó như cũ. Danh sách này chỉ mở thêm quyền, không thu hẹp.
   *
   * Mang kèm TÊN chứ không chỉ id: bảng P-60 hiện tên ở một cột, mà tra tên từ
   * id nghĩa là màn đó phải nạp trọn danh bạ 300 người chỉ để đọc vài cái tên.
   */
  managers: z.array(z.object({ id: z.string(), fullName: z.string() })),
  /**
   * Hướng dẫn mở tài khoản của riêng ngân hàng này; `''` = chưa có.
   *
   * Chữ tự do nhiều dòng. Nhân viên đọc ở bước 2 của màn mở tài khoản, người
   * quản đọc ở bảng ngân hàng.
   */
  guide: z.string(),
  /** URL ảnh mẫu, ĐÚNG thứ tự người nhập xếp — khớp với "Ảnh 1 · Ảnh 2…" trong `guide`. */
  guidePhotoUrls: z.array(z.string()),
});
export type Bank = z.infer<typeof Bank>;

const OptionalAge = z
  .int("Độ tuổi phải là số nguyên")
  .min(0, "Độ tuổi phải từ 0 trở lên")
  .max(130, "Độ tuổi tối đa là 130")
  .nullable();

export const BankForm = z.object({
  code: z.string().trim().min(1, 'Chưa nhập mã ngân hàng'),
  requiredPhotos: z.int('Số ảnh phải là số nguyên').min(0, 'Số ảnh phải từ 0 trở lên').max(SMALLINT_MAX, 'Số ảnh lớn quá'),
  accountNumberMethod: AccountNumberMethod,
  countsAsApp: z.boolean(),
  /**
   * Mức ưu tiên trong ô chọn ngân hàng lúc mở tài khoản — số lớn lên đầu.
   *
   * Từ 0 trở lên, không nhận số âm. `inputMode="numeric"` mở bàn phím không có
   * phím dấu trừ, nên số âm chỉ gõ được trên máy tính — luật phải giống nhau ở
   * mọi thiết bị. Muốn đẩy một ngân hàng xuống cuối thì nâng các ngân hàng
   * khác lên.
   */
  priority: z
    .int('Độ ưu tiên phải là số nguyên')
    .min(0, 'Độ ưu tiên phải từ 0 trở lên')
    .max(SMALLINT_MAX, 'Độ ưu tiên lớn quá'),
  minAge: OptionalAge,
  maxAge: OptionalAge,
  /**
   * Ai quản ngân hàng này — ghi thẳng vào `user_managed_banks`.
   *
   * Đi thẳng vào cột uuid nên bắt dạng ngay ở đây: để lọt chuỗi bậy xuống
   * Postgres là lỗi `22P02`, mà tầng dưới chỉ bắt lỗi trùng khoá nên client
   * nhận 500 thay vì 400.
   *
   * ⚠️ Chỉ người có `system:grant-permission` gửi được trường này. Máy chủ bỏ
   * qua nó với người khác — người quản một ngân hàng KHÔNG tự thêm người vào
   * ngân hàng mình quản, vì đó là đường tự nới quyền.
   */
  managerIds: z.array(z.guid()),
  /** Chữ tự do, không bắt buộc. Ngân hàng chưa có quy trình riêng thì để trống. */
  guide: z.string(),
  /**
   * Ảnh mẫu — nhận URL do `/api/uploads` trả về, máy chủ cắt lại thành khoá.
   *
   * Không đặt trần số ảnh ở đây: quy trình của một ngân hàng dài bao nhiêu là
   * việc của ngân hàng đó, thường 2–3 tấm nhưng có ca sáu tấm.
   */
  guidePhotoUrls: z.array(ImageRef),
}).superRefine((value, ctx) => {
  if (value.minAge !== null && value.maxAge !== null && value.minAge > value.maxAge)
    ctx.addIssue({ code: "custom", path: ["maxAge"], message: "Tuổi tối đa phải lớn hơn hoặc bằng tuổi tối thiểu" });
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
  if (!res.ok) {
    // Máy chủ đã nói rõ vì sao ("Mã ngân hàng này đã có") — nuốt đi rồi ném câu
    // chung chung là bắt người dùng tự đoán mình sai chỗ nào.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message?.trim() || 'Không lưu được');
  }
  return res.json();
}

export const createBank = (form: BankForm) =>
  send('/api/settings/banks', 'POST', form).then(Bank.parse);

export const updateBank = (id: string, form: BankForm) =>
  send(`/api/settings/banks/${id}`, 'PATCH', form).then(Bank.parse);

export const setBankActive = (id: string, active: boolean) =>
  send(`/api/settings/banks/${id}/active`, 'POST', { active }).then(Bank.parse);

/* ── P-61 · Kho mã giới thiệu — chỉ xem, tạo/nhập hàng loạt thuộc P-62 ──── */

/**
 * Phạm vi phòng của một mã (spec §4.4d).
 *
 * `all` — mọi nhân viên chọn được. `departments` — chỉ những phòng trong
 * `departmentIds`.
 */
export const CodeScope = z.enum(['all', 'departments']);
export type CodeScope = z.infer<typeof CodeScope>;

export const CODE_SCOPE_LABEL: Record<CodeScope, string> = {
  all: 'Mọi phòng',
  departments: 'Phòng chỉ định',
};

export const CodeStatus = z.enum(['available', 'low', 'full']);
export type CodeStatus = z.infer<typeof CodeStatus>;

export const CODE_STATUS_LABEL: Record<CodeStatus, string> = {
  available: 'Còn chỗ',
  low: 'Sắp hết',
  full: 'Đã đầy',
};

/**
 * Chạm ngưỡng này là "sắp hết" — cảnh báo trước khi đầy hẳn để kịp xin mã mới.
 *
 * Hằng số nằm ở đây nhưng phép so sánh chạy trong SQL (`server/catalog.ts`).
 * Đừng viết lại công thức trạng thái ở trình duyệt: máy chủ đã lọc theo nó, hai
 * nơi cùng tính là hai nơi lệch nhau, và lúc đó bộ lọc trả về một đằng còn thẻ
 * trạng thái hiện một nẻo.
 */
export const CODE_LOW_RATIO = 0.8;

/**
 * `used` gộp cả số đã tiêu trước khi nhập vào hệ thống (`imported_used`).
 *
 * `holding` là số tài khoản đang mở dở giữ chỗ mã này. Nó là con số ĐỂ HIỆN, KHÔNG
 * phải chốt chặn: đọc xong rồi bấm thì hai người vẫn cùng nhận được chỗ cuối.
 * Chốt thật nằm trong giao dịch tạo tài khoản ở module ngân hàng, khoá dòng
 * `referral_codes` rồi mới kiểm (`mgst-db-design.md` §10).
 *
 * Chỗ còn nhận được tài khoản mới là `total - used - holding`, không phải
 * `total - used`.
 */
/** Link cũ còn giữ để tương thích dữ liệu; giao diện không dùng để mở app. */
export const OpenUrl = z
  .string()
  .trim()
  .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Link phải bắt đầu bằng http:// hoặc https://');

export const ReferralCode = z.object({
  id: z.string(),
  bankId: z.string(),
  bankCode: z.string(),
  /** Nhãn chính trong danh sách; QR-only vẫn cần tên này để nhận biết. */
  displayName: z.string(),
  code: z.string(),
  used: z.number(),
  holding: z.number(),
  total: z.number(),
  status: CodeStatus,
  /** `''` = mã không có link mở tài khoản. Bước 2 P-20 khi đó không dựng nút. */
  openUrl: z.string(),
  /** URL xem ảnh QR; `''` = mã không có ảnh. Bước 2 P-20 khi đó không dựng nút xem. */
  qrImageUrl: z.string(),
  /** Số lớn lên đầu ô chọn mã, trong phạm vi một ngân hàng. 0 là mức thường. */
  priority: z.number(),
  /** Loại tài khoản phải chọn trước để thấy và giữ mã này. */
  accountType: AccountType,
  scope: CodeScope,
  /** Rỗng khi `scope` là `all`. */
  departmentIds: z.array(z.string()),
  /** Tên tỉnh của mã; `''` = chưa gán. Hiện cạnh ô chọn mã ở bước 2 P-20. */
  province: z.string(),
  /** Chi nhánh ngân hàng hỗ trợ; `''` = chưa gán. Cùng chỗ hiện với `province`. */
  supportBranch: z.string(),
  /** `false` = đã ngừng tay: mã rời ô chọn và bị từ chối lúc mở tài khoản. */
  active: z.boolean(),
});
export type ReferralCode = z.infer<typeof ReferralCode>;

export const REFERRAL_CODE_SORT = ['bank', 'code', 'progress', 'priority'] as const;
export type ReferralCodeSort = (typeof REFERRAL_CODE_SORT)[number];

export type ReferralCodeQuery = PageQuery<ReferralCodeSort> & {
  bankId: string;
  /** Rỗng = không giới hạn theo phòng. Mã `all` vẫn khớp khi đã chọn phòng. */
  departmentId: string;
  status: CodeStatus | '';
  search: string;
};

const ReferralCodePage = pageOf(ReferralCode);

/** Một TRANG mã, đã lọc/tìm/sắp sẵn ở máy chủ. */
export async function fetchReferralCodes(query: ReferralCodeQuery): Promise<Page<ReferralCode>> {
  const res = await fetch(
    `/api/settings/referral-codes?${pageParams(query, {
      bankId: query.bankId,
      departmentId: query.departmentId,
      status: query.status,
      search: query.search,
    })}`,
  );
  if (!res.ok) throw new Error('Không tải được kho mã giới thiệu');
  return ReferralCodePage.parse(await res.json());
}

export const BankReferralCodeOption = z.object({ id: z.string(), name: z.string() });
export type BankReferralCodeOption = z.infer<typeof BankReferralCodeOption>;

/**
 * Tên mã của MỘT ngân hàng, cho ô lọc ở trang chi tiết ngân hàng.
 *
 * Trả ID chứ không phải mã text: mã QR-only không có mã text nên lọc theo chuỗi
 * thì chúng không chọn được.
 */
export async function fetchBankReferralCodeOptions(
  bankId: string,
): Promise<BankReferralCodeOption[]> {
  const res = await fetch(`/api/settings/banks/${bankId}/referral-codes`);
  if (!res.ok) throw new Error('Không tải được danh sách mã của ngân hàng');
  return z.array(BankReferralCodeOption).parse(await res.json());
}

/** Tên mã cho ô LỌC ở màn ngân hàng / xuất Excel — gồm cả mã đã đầy. */
export async function fetchReferralCodeOptions(): Promise<string[]> {
  const res = await fetch('/api/settings/referral-codes/options');
  if (!res.ok) throw new Error('Không tải được danh sách mã giới thiệu');
  return z.array(z.string()).parse(await res.json());
}

/**
 * Mã CÒN CHỖ của một ngân hàng, để KD chọn lúc mở tài khoản. Không phân trang.
 *
 * Route riêng chứ không phải `?status=` của bảng trên: ô chọn mà chỉ có 15 mã
 * đầu là ô chọn nói dối. Trả trọn danh sách còn chỗ, xếp mã nhiều chỗ trống lên
 * trước để mã sắp đầy không bị tranh nhau.
 */
/**
 * `departmentId` là phòng GHI NHẬN của bản ghi sắp tạo, không phải phòng trên
 * hồ sơ người gọi (spec §4.4d, chốt câu 1). Với nhân viên thường hai thứ đó
 * bằng nhau; với Ban giám đốc thì chỉ có cái đầu tồn tại.
 *
 * Bỏ trống thì máy chủ tự dùng phòng của người gọi.
 */
export async function fetchOpenReferralCodes(
  bankId: string,
  departmentId = '',
  accountType = '',
): Promise<ReferralCode[]> {
  const res = await fetch(
    `/api/settings/referral-codes/open?bankId=${encodeURIComponent(bankId)}` +
      (departmentId ? `&departmentId=${encodeURIComponent(departmentId)}` : '') +
      (accountType ? `&accountType=${encodeURIComponent(accountType)}` : ''),
  );
  if (!res.ok) throw new Error('Không tải được mã giới thiệu còn chỗ');
  return z.array(ReferralCode).parse(await res.json());
}

/** Thêm một mã lẻ. Nhập hàng loạt từ Excel vẫn là việc riêng của P-62. */
export const ReferralCodeForm = z.object({
  // Đi thẳng vào cột uuid — xem chú thích cùng loại ở `ServiceForm`.
  bankId: z.guid('Chưa chọn ngân hàng'),
  displayName: z.string().trim().min(1, 'Chưa nhập tên hiển thị'),
  /** Bỏ trống khi ngân hàng chỉ cấp QR; máy chủ vẫn bắt buộc có QR lúc lưu. */
  code: z.string().trim(),
  total: z.int('Tổng số phải là số nguyên').min(1, 'Tổng số phải lớn hơn 0').max(INT_MAX, 'Tổng số lớn quá'),
  /** Dữ liệu link cũ để tương thích; biểu mẫu mới không nhập hoặc đọc từ QR. */
  openUrl: OpenUrl,
  /**
   * Ảnh QR đã tải lên kho, `''` = không có. Bước 2 của P-20 mở đúng tấm này ra
   * cho khách quét bằng điện thoại của họ.
   */
  qrImageUrl: QrImageRef,
  /**
   * Mức ưu tiên trong ô chọn mã lúc mở tài khoản — số lớn lên đầu, từ 0 trở
   * lên. Cùng luật với `BankForm.priority`, xem lý do ở đó.
   *
   * Chỉ có tác dụng giữa các mã CÙNG một ngân hàng: ô chọn lọc theo ngân hàng
   * đã chọn ở trên rồi mới sắp.
   */
  priority: z
    .int('Độ ưu tiên phải là số nguyên')
    .min(0, 'Độ ưu tiên phải từ 0 trở lên')
    .max(SMALLINT_MAX, 'Độ ưu tiên lớn quá'),
  accountType: AccountType,
  scope: CodeScope,
  departmentIds: z.array(z.guid()),
  /** Tên tỉnh chọn từ danh sách tham chiếu; `''` = không gán. */
  province: z.string().trim(),
  /** Chi nhánh hỗ trợ, gõ tay; `''` = không gán. */
  supportBranch: z.string().trim(),
})
  /**
   * Chọn "Phòng chỉ định" mà không tick phòng nào là mã KHÔNG AI dùng được —
   * gần như luôn là quên bấm, không phải ý định.
   */
  .refine((form) => form.scope === 'all' || form.departmentIds.length > 0, {
    path: ['departmentIds'],
    message: 'Chọn ít nhất một phòng, hoặc đổi sang Mọi phòng',
  });
export type ReferralCodeForm = z.infer<typeof ReferralCodeForm>;

export const createReferralCode = (form: ReferralCodeForm) =>
  send('/api/settings/referral-codes', 'POST', form).then(ReferralCode.parse);

/**
 * Sửa mã đã lập. Ngân hàng gửi kèm để máy chủ kiểm lại, KHÔNG đổi được.
 *
 * Mã đã nằm trong kho vẫn cần sửa: link mở tài khoản đến sau khi ngân hàng gửi
 * ảnh QR, và tổng số lượt thì ngân hàng cấp thêm theo đợt. Máy chủ từ chối khi
 * hạ tổng xuống dưới phần đã tiêu cộng phần đang giữ.
 */
export const updateReferralCode = (id: string, form: ReferralCodeForm) =>
  send(`/api/settings/referral-codes/${id}`, 'PATCH', form).then(ReferralCode.parse);

/** Ngừng / dùng lại một mã — không xoá, tài khoản cũ vẫn trỏ vào mã. */
export const setReferralCodeActive = (id: string, active: boolean) =>
  send(`/api/settings/referral-codes/${id}/active`, 'POST', { active }).then(ReferralCode.parse);

import { z } from 'zod';
import { INT_MAX, SMALLINT_MAX } from './limits';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

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
  /**
   * Nhân viên được giao quản ngân hàng này (chốt 2026-08-24).
   *
   * Rỗng = chưa giao cho ai, và ngân hàng vẫn chạy bình thường — người ở phạm
   * vi `all` sửa được nó như cũ. Danh sách này chỉ mở thêm quyền, không thu hẹp.
   */
  managerIds: z.array(z.string()),
});
export type Bank = z.infer<typeof Bank>;

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
  managerIds: z.array(z.uuid()),
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

/** Nhân viên chọn được vào ô "Người quản" — chỉ người đã có `system:manage-bank`. */
export const BankManagerOption = z.object({
  id: z.string(),
  fullName: z.string(),
  username: z.string(),
  title: z.string(),
});
export type BankManagerOption = z.infer<typeof BankManagerOption>;

export async function fetchBankManagerOptions(): Promise<BankManagerOption[]> {
  const res = await fetch('/api/settings/banks/managers');
  if (!res.ok) throw new Error('Không tải được danh sách người quản ngân hàng');
  return z.array(BankManagerOption).parse(await res.json());
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
/**
 * Link mở tài khoản — CHỈ nhận `http` và `https`.
 *
 * Chuỗi này đi thẳng vào `href` của nút "Mở app ngân hàng" ở bước 2 P-20.
 * Không chặn thì một QR chứa `javascript:` biến nút đó thành đường chạy mã tuỳ
 * ý trên máy nhân viên. Máy chủ kiểm LẠI bằng đúng schema này — ảnh QR giải ở
 * trình duyệt nên chuỗi gửi lên nặn tay được.
 *
 * `''` = không có link, hợp lệ. Ngân hàng nào không phát link thì ô để trống.
 */
export const OpenUrl = z
  .string()
  .trim()
  .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Link phải bắt đầu bằng http:// hoặc https://');

/**
 * Ảnh QR do chính `/api/uploads` trả về; `''` = mã không có ảnh.
 *
 * Ở đây chỉ kiểm phần ĐẦU chuỗi. Chốt thật nằm ở máy chủ: `imageKeyOf`
 * (`server/storage.ts`) khớp trọn hình dạng khoá rồi mới ghi, chuỗi nào không
 * khớp thì mã lưu về không có ảnh. Chép nguyên mẫu khoá xuống đây là hai bản
 * luật cho một việc, và chúng lệch nhau ngay lần đổi kho ảnh đầu tiên.
 */
export const QrImageRef = z
  .string()
  .trim()
  .refine((v) => v === '' || v.startsWith('/api/images/'), 'Ảnh QR không hợp lệ');

export const ReferralCode = z.object({
  id: z.string(),
  bankId: z.string(),
  bankCode: z.string(),
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
  scope: CodeScope,
  /** Rỗng khi `scope` là `all`. */
  departmentIds: z.array(z.string()),
});
export type ReferralCode = z.infer<typeof ReferralCode>;

export const REFERRAL_CODE_SORT = ['bank', 'code', 'progress', 'priority'] as const;
export type ReferralCodeSort = (typeof REFERRAL_CODE_SORT)[number];

export type ReferralCodeQuery = PageQuery<ReferralCodeSort> & {
  bankId: string;
  status: CodeStatus | '';
  search: string;
};

const ReferralCodePage = pageOf(ReferralCode);

/** Một TRANG mã, đã lọc/tìm/sắp sẵn ở máy chủ. */
export async function fetchReferralCodes(query: ReferralCodeQuery): Promise<Page<ReferralCode>> {
  const res = await fetch(
    `/api/settings/referral-codes?${pageParams(query, {
      bankId: query.bankId,
      status: query.status,
      search: query.search,
    })}`,
  );
  if (!res.ok) throw new Error('Không tải được kho mã giới thiệu');
  return ReferralCodePage.parse(await res.json());
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
): Promise<ReferralCode[]> {
  const res = await fetch(
    `/api/settings/referral-codes/open?bankId=${encodeURIComponent(bankId)}` +
      (departmentId ? `&departmentId=${encodeURIComponent(departmentId)}` : ''),
  );
  if (!res.ok) throw new Error('Không tải được mã giới thiệu còn chỗ');
  return z.array(ReferralCode).parse(await res.json());
}

/** Thêm một mã lẻ. Nhập hàng loạt từ Excel vẫn là việc riêng của P-62. */
export const ReferralCodeForm = z.object({
  // Đi thẳng vào cột uuid — xem chú thích cùng loại ở `ServiceForm`.
  bankId: z.uuid('Chưa chọn ngân hàng'),
  code: z.string().trim().min(1, 'Chưa nhập mã'),
  total: z.int('Tổng số phải là số nguyên').min(1, 'Tổng số phải lớn hơn 0').max(INT_MAX, 'Tổng số lớn quá'),
  /**
   * Giải ra từ ảnh QR ngay ở trình duyệt, hoặc người dùng gõ tay khi ảnh mờ
   * không đọc được. Chuỗi này và ảnh ở `qrImageUrl` là hai thứ RỜI NHAU: gõ
   * link tay mà không có ảnh là hợp lệ, và ngược lại.
   */
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
  scope: CodeScope,
  departmentIds: z.array(z.uuid()),
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

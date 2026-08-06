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
});
export type Bank = z.infer<typeof Bank>;

export const BankForm = z.object({
  code: z.string().trim().min(1, 'Chưa nhập mã ngân hàng'),
  requiredPhotos: z.int('Số ảnh phải là số nguyên').min(0, 'Số ảnh phải từ 0 trở lên').max(SMALLINT_MAX, 'Số ảnh lớn quá'),
  accountNumberMethod: AccountNumberMethod,
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
export const ReferralCode = z.object({
  id: z.string(),
  bankId: z.string(),
  bankCode: z.string(),
  code: z.string(),
  used: z.number(),
  holding: z.number(),
  total: z.number(),
  status: CodeStatus,
});
export type ReferralCode = z.infer<typeof ReferralCode>;

export const REFERRAL_CODE_SORT = ['bank', 'code', 'progress'] as const;
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
export async function fetchOpenReferralCodes(bankId: string): Promise<ReferralCode[]> {
  const res = await fetch(`/api/settings/referral-codes/open?bankId=${encodeURIComponent(bankId)}`);
  if (!res.ok) throw new Error('Không tải được mã giới thiệu còn chỗ');
  return z.array(ReferralCode).parse(await res.json());
}

/** Thêm một mã lẻ. Nhập hàng loạt từ Excel vẫn là việc riêng của P-62. */
export const ReferralCodeForm = z.object({
  bankId: z.string().trim().min(1, 'Chưa chọn ngân hàng'),
  code: z.string().trim().min(1, 'Chưa nhập mã'),
  total: z.int('Tổng số phải là số nguyên').min(1, 'Tổng số phải lớn hơn 0').max(INT_MAX, 'Tổng số lớn quá'),
});
export type ReferralCodeForm = z.infer<typeof ReferralCodeForm>;

export const createReferralCode = (form: ReferralCodeForm) =>
  fetch('/api/settings/referral-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  }).then(async (res) => {
    if (!res.ok) throw new Error('Không lưu được mã này');
    return ReferralCode.parse(await res.json());
  });

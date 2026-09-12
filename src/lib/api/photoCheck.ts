import { z } from 'zod';

/**
 * Kết quả kiểm ảnh chứng minh tài khoản ngân hàng bằng OCR (chốt 2026-09-11).
 *
 * Worker `scripts/photo-check-worker.ts` ghi `PhotoCheckResult` vào
 * `bank_account_checks.result`; màn danh sách và màn chi tiết đọc `PhotoCheck`,
 * là lượt mới nhất của tài khoản. `null` = ngân hàng chưa có bộ nhãn, hoặc tài
 * khoản chưa hoàn thành.
 *
 * Ba phép kiểm, mỗi ngân hàng một bộ nhãn ở `server/ocr/banks/<mã>.ts`:
 *
 *   open      màn hoàn tất mở/đăng ký tài khoản; trường cần so do từng ngân hàng quy định
 *   home      màn thông tin trong app (màn chính hoặc bước bổ sung thông tin)
 *   transfer  màn giao dịch/chuyển khoản thành công
 */
export const PhotoCheckKey = z.enum(['open', 'home', 'transfer']);
export type PhotoCheckKey = z.infer<typeof PhotoCheckKey>;

export const PHOTO_CHECK_LABEL: Record<PhotoCheckKey, string> = {
  open: 'Mở tài khoản',
  home: 'Thông tin trong app',
  transfer: 'Giao dịch',
};

/** `missing` = không ảnh nào là màn này. Khác `fail`: có ảnh nhưng đọc ra sai. */
export const PhotoCheckVerdict = z.enum(['pass', 'fail', 'missing']);
export type PhotoCheckVerdict = z.infer<typeof PhotoCheckVerdict>;

export const PhotoCheckItem = z.object({
  key: PhotoCheckKey,
  verdict: PhotoCheckVerdict,
  /** Tên phép đối chiếu theo ngôn ngữ nghiệp vụ, không phải tên màn hình app. */
  label: z.string().optional(),
  /** Các lỗi ngắn để hiện trên cảnh báo và thông báo đẩy. */
  issues: z.array(z.string()).optional(),
  /** Giá trị OCR đọc được, để người duyệt đối chiếu. `''` khi không có. */
  found: z.string(),
  /** Giá trị trong hệ thống. `''` khi phép kiểm không so với gì. */
  expected: z.string(),
  /** Vì sao không đạt, một câu. */
  note: z.string(),
});
export type PhotoCheckItem = z.infer<typeof PhotoCheckItem>;

/**
 * Lỗi nghiệp vụ ngắn gọn của một kết quả không đạt.
 *
 * `issues` có ở các lượt OCR mới. Phần nhận dạng từ `note` giữ tương thích với
 * dữ liệu JSON đã lưu trước khi thêm trường này, nên không phải chạy lại toàn
 * bộ tài khoản chỉ để đổi cách hiển thị.
 */
export function photoCheckIssueLabels(item: PhotoCheckItem): string[] {
  if (item.issues?.length) return item.issues;

  const note = item.note;
  const issues: string[] = [];
  const add = (value: string) => {
    if (!issues.includes(value)) issues.push(value);
  };

  if (/không đọc được mã giới thiệu/i.test(note)) add('Không đọc được mã giới thiệu');
  else if (/mã trên ảnh/i.test(note)) add('Mã giới thiệu không khớp');

  if (/không đọc được (?:tên khách|tên chủ tài khoản)/i.test(note))
    add('Không đọc được tên khách hàng');
  else if (/tên trên ảnh/i.test(note)) add('Tên khách hàng không khớp');

  if (/số tài khoản trên ảnh/i.test(note)) add('Số tài khoản không khớp');
  if (/không đọc được chi nhánh\/PGD/i.test(note)) add('Không đọc được Chi nhánh/PGD');
  else if (/chi nhánh\/PGD trên ảnh/i.test(note)) add('Chi nhánh/PGD không khớp');
  if (/không đọc được số tiền/i.test(note)) add('Không đọc được số tiền giao dịch');
  if (/người gửi trên ảnh/i.test(note)) add('Tên người gửi không khớp');
  if (/tài khoản gửi trên ảnh/i.test(note)) add('Tài khoản gửi không khớp');

  if (issues.length) return issues;
  if (item.verdict === 'missing') {
    if (item.key === 'transfer') return ['Thiếu ảnh giao dịch thành công'];
    return [`Thiếu ảnh xác thực ${item.label?.toLocaleLowerCase('vi') || 'thông tin tài khoản'}`];
  }
  return [`${item.label || PHOTO_CHECK_LABEL[item.key]} không đạt`];
}

/** Thứ worker ghi vào `bank_account_checks.result`. */
export const PhotoCheckResult = z.object({ items: z.array(PhotoCheckItem) });
export type PhotoCheckResult = z.infer<typeof PhotoCheckResult>;

export const PhotoCheckStatus = z.enum(['pending', 'done', 'failed']);
export type PhotoCheckStatus = z.infer<typeof PhotoCheckStatus>;

/** Lượt kiểm MỚI NHẤT của một tài khoản, trả kèm mỗi dòng danh sách và chi tiết. */
export const PhotoCheck = z.object({
  status: PhotoCheckStatus,
  /** ISO, `''` khi chưa xong. */
  checkedAt: z.string(),
  /** Lý do worker hỏng, chỉ khi `failed`. */
  error: z.string(),
  /** Rỗng khi chưa xong hoặc hỏng. */
  items: z.array(PhotoCheckItem),
  /**
   * Số phép kiểm đạt trên tổng số, ví dụ 2/3. Bảng hiện con số này chứ không
   * hiện từng phép kiểm: ngân hàng khác có thể có 6 phép, cột không nở theo.
   */
  passed: z.number(),
  total: z.number(),
  /**
   * Người duyệt xác nhận ảnh đạt dù máy chấm không đạt. `''` = chưa ai xác
   * nhận. Có xác nhận thì điểm hiệu lực là đạt hết, xem `effectiveScore`.
   */
  confirmedByName: z.string(),
  confirmedAt: z.string(),
});
export type PhotoCheck = z.infer<typeof PhotoCheck>;

/** Điểm hiện ra và dùng để lọc: người duyệt xác nhận thì đạt hết, chưa thì điểm máy. */
export const effectiveScore = (check: PhotoCheck): { passed: number; total: number } =>
  check.confirmedAt ? { passed: check.total, total: check.total } : { passed: check.passed, total: check.total };

/**
 * Ô lọc trên bảng. `fail` = lượt mới nhất đã xong, máy chấm không đạt hết, và
 * chưa ai xác nhận; `pass` = máy chấm đạt hết hoặc người duyệt đã xác nhận.
 * Rỗng = không lọc.
 */
export const PhotoCheckFilter = z.enum(['fail', 'pass']);
export type PhotoCheckFilter = z.infer<typeof PhotoCheckFilter>;

export const PHOTO_CHECK_FILTER_LABEL: Record<PhotoCheckFilter, string> = {
  fail: 'Không đạt',
  pass: 'Đạt',
};

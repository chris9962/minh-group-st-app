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
 *   open      màn "Mở tài khoản thành công": mã giới thiệu đúng mã đã chọn,
 *             số tài khoản đúng số đã nhập
 *   home      màn hình chính app: tên khách đúng, số tài khoản đúng
 *   transfer  màn chuyển khoản thành công: có tên ngân hàng, chữ thành công, số tiền
 */
export const PhotoCheckKey = z.enum(['open', 'home', 'transfer']);
export type PhotoCheckKey = z.infer<typeof PhotoCheckKey>;

export const PHOTO_CHECK_LABEL: Record<PhotoCheckKey, string> = {
  open: 'Mở tài khoản',
  home: 'Màn hình chính',
  transfer: 'Chuyển khoản',
};

/** `missing` = không ảnh nào là màn này. Khác `fail`: có ảnh nhưng đọc ra sai. */
export const PhotoCheckVerdict = z.enum(['pass', 'fail', 'missing']);
export type PhotoCheckVerdict = z.infer<typeof PhotoCheckVerdict>;

export const PhotoCheckItem = z.object({
  key: PhotoCheckKey,
  verdict: PhotoCheckVerdict,
  /** Giá trị OCR đọc được, để người duyệt đối chiếu. `''` khi không có. */
  found: z.string(),
  /** Giá trị trong hệ thống. `''` khi phép kiểm không so với gì. */
  expected: z.string(),
  /** Vì sao không đạt, một câu. */
  note: z.string(),
});
export type PhotoCheckItem = z.infer<typeof PhotoCheckItem>;

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
});
export type PhotoCheck = z.infer<typeof PhotoCheck>;

/**
 * Ô lọc trên bảng. `fail` = lượt mới nhất đã xong và có phép kiểm không đạt;
 * `pass` = đã xong và đạt hết. Rỗng = không lọc.
 */
export const PhotoCheckFilter = z.enum(['fail', 'pass']);
export type PhotoCheckFilter = z.infer<typeof PhotoCheckFilter>;

export const PHOTO_CHECK_FILTER_LABEL: Record<PhotoCheckFilter, string> = {
  fail: 'Có điểm không đạt',
  pass: 'Đạt hết',
};

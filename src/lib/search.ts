/** Trần ô tìm — tên khách dài nhất khoảng 6 từ, thêm một mã đơn là 7. */
export const SEARCH_MAX_TERMS = 8;
export const SEARCH_MAX_LENGTH = 100;

/**
 * Tách chuỗi tìm thành từ, CẮT TRẦN ở máy chủ.
 *
 * Mỗi từ thành một điều kiện con trong câu SQL. Không cắt thì một lượt dán nhầm
 * cả trang web vào ô tìm (288 từ, 2026-09-04 11:53) thành 288 `exists` trong một
 * câu, và riêng bước lập kế hoạch của Postgres đã chiếm 15 GB rồi kéo cả máy
 * chủ xuống. `maxLength` ở giao diện chỉ là tiện, không phải chốt: URL gõ tay
 * đi thẳng vào đây.
 */
export function searchTerms(raw: string): string[] {
  return raw
    .slice(0, SEARCH_MAX_LENGTH)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SEARCH_MAX_TERMS);
}

import { z } from 'zod';

/**
 * Hợp đồng chung của MỌI danh sách phân trang.
 *
 * Luật của dự án (AGENTS.md §5.1): phân trang, sắp xếp, tìm kiếm và lọc đều
 * chạy ở MÁY CHỦ. Trình duyệt gửi câu hỏi, máy chủ trả đúng một trang. Không
 * có màn nào tải cả bảng rồi tự cắt — đó là thứ chạy tốt trên máy người viết
 * và chết trên dữ liệu thật.
 *
 * File này giữ đúng phần dùng chung để mỗi module không tự chế một kiểu vỏ
 * riêng. Bên máy chủ có `src/server/pagination.ts` là nửa còn lại.
 */

/** Số dòng mỗi trang. Một con số cho cả hệ thống — bảng nào cũng cuộn như nhau. */
export const PAGE_SIZE = 15;

export const SortDir = z.enum(['asc', 'desc']);
export type SortDir = z.infer<typeof SortDir>;

/**
 * `total` là tổng số dòng KHỚP BỘ LỌC, không phải tổng số dòng của bảng — thanh
 * "1–15 trên 240" nói về kết quả tìm, không nói về kho.
 */
export function pageOf<T extends z.ZodTypeAny>(row: T) {
  return z.object({ rows: z.array(row), total: z.number() });
}

export type Page<T> = { rows: T[]; total: number };

/** Trang rỗng — dùng làm `data` mặc định để nơi gọi khỏi phải kiểm `undefined`. */
export const EMPTY_PAGE: Page<never> = { rows: [], total: 0 };

/** Phần phân trang/sắp xếp mà mọi truy vấn danh sách đều có. */
export type PageQuery<Sort extends string = string> = {
  /** Đếm từ 0. */
  page: number;
  sort: Sort;
  dir: SortDir;
};

/**
 * Nắn truy vấn thành query string.
 *
 * Nhận `extra` cho phần lọc riêng của từng màn. Bỏ chuỗi rỗng đi để URL không
 * dính `&status=` vô nghĩa — khoá của TanStack Query bám theo URL này.
 */
export function pageParams(query: PageQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    page: String(query.page),
    sort: query.sort,
    dir: query.dir,
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

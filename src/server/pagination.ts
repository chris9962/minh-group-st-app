import { PAGE_SIZE, SortDir } from "@/lib/api/pagination";

/**
 * Đọc phần phân trang/sắp xếp từ URL. Nửa máy chủ của `lib/api/pagination.ts`.
 *
 * Mọi route trả danh sách đều đi qua đây, không route nào tự đọc
 * `searchParams.get("page")` — tự đọc là sớm muộn có chỗ quên chặn.
 */

const MAX_PAGE = 1_000_000;

export type PageArgs<Sort extends string> = {
  limit: number;
  offset: number;
  sort: Sort;
  dir: "asc" | "desc";
};

/**
 * `sortable` là DANH SÁCH TRẮNG các khoá được sắp, và đây là điều kiện bắt buộc
 * chứ không phải cho gọn: khoá sắp xếp đi thẳng vào `ORDER BY`. Nhận đại chuỗi
 * của trình duyệt là mở cửa cho người ta sắp theo cột mình không được thấy, hoặc
 * tệ hơn là nhét SQL vào. Khoá lạ thì rơi về `fallback`, không báo lỗi — người
 * dùng sửa URL sai không đáng phải nhận màn hỏng.
 */
export function pageArgsFrom<Sort extends string>(
  url: URL,
  sortable: readonly Sort[],
  fallback: Sort,
  /** Cỡ trang do ROUTE quyết định, không đọc từ URL — hai đầu phải cùng một hằng. */
  size: number = PAGE_SIZE,
): PageArgs<Sort> {
  const params = url.searchParams;

  const asked = params.get("sort");
  const sort = sortable.includes(asked as Sort) ? (asked as Sort) : fallback;

  const dir = SortDir.safeParse(params.get("dir"));

  /**
   * Trang âm, `NaN` (?page=abc), hay số khổng lồ (?page=1e18) đều về 0. Mỗi thứ
   * làm vỡ một kiểu: `OFFSET -15` là lỗi cú pháp, còn `1e18 × 15` vượt trần
   * `bigint` của Postgres. Một ô địa chỉ gõ nhầm không nên thành màn trắng.
   *
   * Trần đặt ở `MAX_PAGE` chứ không phải giới hạn của số nguyên: không kho dữ
   * liệu nào của hệ thống này có tới 15 triệu dòng, quá số đó chắc chắn là URL
   * bịa chứ không phải người dùng thật đang lật trang.
   */
  const askedPage = Number(params.get("page"));
  const page =
    Number.isInteger(askedPage) && askedPage > 0 ? Math.min(askedPage, MAX_PAGE) : 0;

  return { limit: size, offset: page * size, sort, dir: dir.success ? dir.data : "desc" };
}

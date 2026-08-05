import { PAGE_SIZE, SortDir } from "@/lib/api/pagination";

/**
 * Đọc phần phân trang/sắp xếp từ URL. Nửa máy chủ của `lib/api/pagination.ts`.
 *
 * Mọi route trả danh sách đều đi qua đây, không route nào tự đọc
 * `searchParams.get("page")` — tự đọc là sớm muộn có chỗ quên chặn.
 */

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
): PageArgs<Sort> {
  const params = url.searchParams;

  const asked = params.get("sort");
  const sort = sortable.includes(asked as Sort) ? (asked as Sort) : fallback;

  const dir = SortDir.safeParse(params.get("dir"));

  // Trang âm hay `NaN` (?page=abc) đều về 0. `OFFSET -15` là lỗi Postgres, một
  // ô địa chỉ gõ nhầm không nên thành màn trắng.
  const askedPage = Number(params.get("page"));
  const page = Number.isFinite(askedPage) && askedPage > 0 ? Math.floor(askedPage) : 0;

  return { limit: PAGE_SIZE, offset: page * PAGE_SIZE, sort, dir: dir.success ? dir.data : "desc" };
}

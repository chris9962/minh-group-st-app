"use client";

import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import styles from "./RankTable.module.css";

export type RankColumn<T> = {
  key: string;
  label: string;
  /** Giá trị dùng để sắp xếp ở chế độ trình duyệt. Không có thì cột không bấm sắp được. */
  sortBy?: (row: T) => number;
  /**
   * Bản CHỮ của `sortBy`, cho cột chứa tên. So bằng `localeCompare` nên `Đặng`
   * xếp sau `Dũng` chứ không nhảy xuống cuối bảng như khi so mã ký tự.
   *
   * Tách khỏi `sortBy` chứ không cho nó trả cả hai kiểu: `sortBy` còn quyết định
   * ô có dùng `tabular-nums` hay không, mà cột tên thì không phải cột số.
   */
  sortText?: (row: T) => string;
  /**
   * Bấm sắp được hay không, khi việc sắp do máy chủ làm (`server`) nên không có
   * `sortBy`. Khoá gửi lên máy chủ chính là `key`.
   *
   * CHỈ có tác dụng khi có `server`. Ở chế độ trình duyệt thì bị bỏ qua, vì bảng
   * không biết sắp bằng gì: bật nút lên thì mũi tên và `aria-sort` báo là đã sắp
   * trong khi thứ tự không đổi — nói dối cả người nhìn lẫn trình đọc màn hình.
   */
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  /** Cột tỉ lệ vẽ kèm thanh nền — xem `ratio`. */
  ratio?: (row: T) => number;
};

/**
 * Sắp xếp và phân trang do MÁY CHỦ làm; bảng chỉ hiện và báo lên khi người dùng
 * bấm. `rows` lúc này là đúng một trang, đã sắp sẵn — bảng không đụng vào.
 */
export type RankServer = {
  sort: string;
  dir: "asc" | "desc";
  /** Đếm từ 0. */
  page: number;
  /** Tổng số dòng KHỚP BỘ LỌC, không phải số dòng đang hiện. */
  total: number;
  pageSize: number;
  onSortChange: (sort: string, dir: "asc" | "desc") => void;
  onPageChange: (page: number) => void;
};

type Props<T> = {
  rows: T[];
  columns: RankColumn<T>[];
  rowKey: (row: T) => string;
  /** Khoá cột sắp mặc định. Bỏ qua khi có `server` — lúc đó `server.sort` là nguồn. */
  defaultSort: string;
  caption: string;
  /**
   * Số dòng mỗi trang, cắt ở trình duyệt. Bỏ trống thì hiện hết.
   *
   * Chỉ dùng cho DANH MỤC ĐÓNG (danh sách ngân hàng, loại dịch vụ…) — vài chục
   * dòng, không lớn thêm. Danh sách lớn dần theo ngày thì dùng `server`, đừng
   * tải cả bảng về rồi cắt (AGENTS.md §5.1).
   */
  pageSize?: number;
  server?: RankServer;
  /**
   * Câu hiện khi không có dòng nào. Thiếu nó thì người dùng chỉ thấy hàng tiêu
   * đề trống trơn, không phân biệt được "chưa có gì" với "tải xong nhưng hỏng".
   */
  emptyText?: string;
  /**
   * Bấm vào một dòng thì mở chi tiết. Có nó thì dòng đổi con trỏ và sáng lên
   * khi rê chuột.
   *
   * ⚠️ Đây là lối tắt cho CHUỘT, không phải cách duy nhất. Thẻ `<tr>` không
   * nhận tiêu điểm bàn phím, mà gắn `role="button"` lên nó thì trình đọc màn
   * hình mất luôn cấu trúc bảng. Màn nào dùng prop này PHẢI đặt thêm một
   * `<button>` thật trong một ô — xem cột "Nội dung" ở P-96.
   */
  onRowClick?: (row: T) => void;
};

/**
 * Bảng xếp hạng có sắp xếp theo cột.
 *
 * Cố ý KHÔNG dùng TanStack Table ở đây: bảng chỉ vài cột. Dùng thư viện chỉ
 * thêm một lớp gián tiếp.
 */
export function RankTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  caption,
  pageSize,
  server,
  emptyText,
  onRowClick,
}: Props<T>) {
  const [sortKey, setSortKey] = useState(defaultSort);
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);

  const activeSort = server ? server.sort : sortKey;
  const activeAsc = server ? server.dir === "asc" : asc;

  const sorted = useMemo(() => {
    if (server) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const { sortBy, sortText } = col;
    if (sortText)
      return [...rows].sort((a, b) => {
        const d = sortText(a).localeCompare(sortText(b), "vi");
        return asc ? d : -d;
      });
    if (!sortBy) return rows;
    return [...rows].sort((a, b) => (asc ? sortBy(a) - sortBy(b) : sortBy(b) - sortBy(a)));
  }, [server, rows, columns, sortKey, asc]);

  const size = server ? server.pageSize : pageSize;
  const totalRows = server ? server.total : sorted.length;
  const pageCount = size ? Math.ceil(totalRows / size) : 1;
  const maxPage = Math.max(0, pageCount - 1);
  const current = Math.min(server ? server.page : page, maxPage);
  const visible = server || !pageSize ? sorted : sorted.slice(current * pageSize, (current + 1) * pageSize);

  /**
   * Kéo trang cha về trang có thật khi `total` co lại dưới trang đang xem.
   *
   * Kẹp `current` ở trên chỉ chữa được thanh phân trang: `rows` vẫn là kết quả
   * của lượt gọi cắt từ dòng 16 của một danh sách 15 dòng, tức rỗng. Bảng không
   * tự gọi mạng nên phải báo ngược để trang cha đổi khoá truy vấn và lấy lại.
   *
   * Không có nó thì `pageCount > 1` thành sai, thanh phân trang biến mất, và
   * người dùng ở lại trang rỗng không có nút lùi.
   *
   * ⚠️ Đây là lớp che, KHÔNG phải chỗ xử lý chính. Nó chạy SAU khi lượt gọi sai
   * đã đi và về. Đường nào biết trước danh sách sắp co — xoá một dòng chẳng hạn
   * — thì phải tự lùi trang ngay tại nơi gọi, xem `banking/page.tsx` `remove`.
   */
  useEffect(() => {
    if (server && server.page > maxPage) server.onPageChange(maxPage);
  }, [server, maxPage]);

  const goTo = (next: number) => (server ? server.onPageChange(next) : setPage(next));

  const toggle = (key: string) => {
    // Đổi cột sắp thì về trang đầu, nếu không người dùng đang ở trang 3 sẽ
    // thấy một khúc giữa vô nghĩa.
    const nextAsc = key === activeSort ? !activeAsc : false;
    if (server) {
      server.onSortChange(key, nextAsc ? "asc" : "desc");
      return;
    }
    setPage(0);
    setSortKey(key);
    setAsc(nextAsc);
  };

  return (
    <div className="table-scroll">
      <table className={`table ${styles.table}`}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = col.key === activeSort;
              const canSort = server
                ? (col.sortable ?? false)
                : Boolean(col.sortBy || col.sortText);
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={col.align === "right" ? styles.right : undefined}
                  aria-sort={
                    active ? (activeAsc ? "ascending" : "descending") : undefined
                  }
                >
                  {canSort ? (
                    <button
                      type="button"
                      className={styles.sortBtn}
                      onClick={() => toggle(col.key)}
                    >
                      {col.label}
                      <span aria-hidden className={styles.caret}>
                        {active ? (activeAsc ? "↑" : "↓") : ""}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && emptyText && (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {emptyText}
              </td>
            </tr>
          )}
          {visible.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? styles.clickable : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={clsx(
                    col.align === "right" ? styles.right : undefined,
                    col.sortBy ? "tabular-nums" : undefined,
                  )}
                >
                  {col.ratio ? (
                    <span className={styles.ratioCell}>
                      <span className={styles.track} aria-hidden>
                        <span
                          className={styles.fill}
                          style={{ width: `${Math.min(100, col.ratio(row))}%` }}
                        />
                      </span>
                      {col.render(row)}
                    </span>
                  ) : (
                    col.render(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {size && pageCount > 1 && (
        <div className={styles.pager}>
          <span className={styles.range}>
            {current * size + 1}–{Math.min((current + 1) * size, totalRows)} trên {totalRows}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => goTo(current - 1)}
            disabled={current === 0}
          >
            Trước
          </button>
          <span className={styles.pageNo}>
            {current + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => goTo(current + 1)}
            disabled={current >= pageCount - 1}
          >
            Sau
          </button>
        </div>
      )}
    </div>
  );
}

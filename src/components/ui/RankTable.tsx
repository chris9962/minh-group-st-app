"use client";

import { useMemo, useState } from "react";
import styles from "./RankTable.module.css";

export type RankColumn<T> = {
  key: string;
  label: string;
  /** Giá trị dùng để sắp xếp ở chế độ trình duyệt. Không có thì cột không bấm sắp được. */
  sortBy?: (row: T) => number;
  /**
   * Bấm sắp được hay không, khi việc sắp do máy chủ làm (`server`) nên không có
   * `sortBy`. Khoá gửi lên máy chủ chính là `key`.
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
}: Props<T>) {
  const [sortKey, setSortKey] = useState(defaultSort);
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);

  const activeSort = server ? server.sort : sortKey;
  const activeAsc = server ? server.dir === "asc" : asc;

  const sorted = useMemo(() => {
    if (server) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortBy) return rows;
    const by = col.sortBy;
    return [...rows].sort((a, b) => (asc ? by(a) - by(b) : by(b) - by(a)));
  }, [server, rows, columns, sortKey, asc]);

  const size = server ? server.pageSize : pageSize;
  const totalRows = server ? server.total : sorted.length;
  const pageCount = size ? Math.ceil(totalRows / size) : 1;
  const current = server ? server.page : Math.min(page, Math.max(0, pageCount - 1));
  const visible = server || !pageSize ? sorted : sorted.slice(current * pageSize, (current + 1) * pageSize);

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
              const canSort = col.sortable ?? Boolean(col.sortBy);
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
          {visible.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={[
                    col.align === "right" ? styles.right : undefined,
                    col.sortBy ? "tabular-nums" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ")}
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

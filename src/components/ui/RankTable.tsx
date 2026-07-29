"use client";

import { useMemo, useState } from "react";
import styles from "./RankTable.module.css";

export type RankColumn<T> = {
  key: string;
  label: string;
  /** Giá trị dùng để sắp xếp. Không có thì cột không bấm sắp được. */
  sortBy?: (row: T) => number;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  /** Cột tỉ lệ vẽ kèm thanh nền — xem `ratio`. */
  ratio?: (row: T) => number;
};

type Props<T> = {
  rows: T[];
  columns: RankColumn<T>[];
  rowKey: (row: T) => string;
  /** Khoá cột sắp mặc định. */
  defaultSort: string;
  caption: string;
};

/**
 * Bảng xếp hạng có sắp xếp theo cột.
 *
 * Cố ý KHÔNG dùng TanStack Table ở đây: bảng chỉ vài cột, không phân trang,
 * không lọc. Dùng thư viện chỉ thêm một lớp gián tiếp. Tới các màn danh sách
 * lớn (P-13, P-21, P-51) thì mới cần.
 */
export function RankTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  caption,
}: Props<T>) {
  const [sortKey, setSortKey] = useState(defaultSort);
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortBy) return rows;
    const by = col.sortBy;
    return [...rows].sort((a, b) => (asc ? by(a) - by(b) : by(b) - by(a)));
  }, [rows, columns, sortKey, asc]);

  const toggle = (key: string) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  return (
    <div className="bang-cuon">
      <table className={`table ${styles.table}`}>
        <caption className="an-nhin">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={col.align === "right" ? styles.right : undefined}
                  aria-sort={
                    active ? (asc ? "ascending" : "descending") : undefined
                  }
                >
                  {col.sortBy ? (
                    <button
                      type="button"
                      className={styles.sortBtn}
                      onClick={() => toggle(col.key)}
                    >
                      {col.label}
                      <span aria-hidden className={styles.caret}>
                        {active ? (asc ? "↑" : "↓") : ""}
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
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={[
                    col.align === "right" ? styles.right : undefined,
                    col.sortBy ? "so" : undefined,
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
    </div>
  );
}

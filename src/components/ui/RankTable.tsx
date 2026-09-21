"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RankTable.module.css";
import {
  rankingDelta,
  rankingDeltaLabel,
  rankingDeltaText,
  rankingHighlight,
  rankingLabel,
  rankingPlace,
  rankingPlacesByValue,
  rankingTip,
} from "./ranking";

export type RankColumn<T> = {
  key: string;
  label: React.ReactNode;
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
  /**
   * Giá trị kỳ trước của cùng cột `sortBy`, để bảng xếp hạng tính mũi tên
   * lên/xuống hạng. `null` = không so được dòng này.
   *
   * Chỉ có nghĩa khi có `highlightTop`. Bảng danh sách không điền.
   */
  sortPrevious?: (row: T) => number | null;
  /**
   * Câu hiện khi rê chuột lên ô. Bảng xếp hạng dùng để đọc số đầy đủ (phần
   * của tổng, dãy 7 ngày) khi ô chỉ còn thanh hoặc sparkline.
   */
  title?: (row: T) => string | null;
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
   * Một hàng tổng nằm cuối bảng. Mảng phải đi đúng thứ tự `columns`; bảng chỉ
   * lo hình thức để mỗi màn tự quyết định số nào có nghĩa để cộng.
   */
  summaryRow?: React.ReactNode[];
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
  /**
   * Dòng thành LINK thật thay vì `onRowClick` — chuột phải mở tab mới được, và
   * Ctrl/Cmd+bấm cũng vậy (chốt 2026-09-05).
   *
   * Mỗi ô mang một `<a>` phủ kín ô, nên chuột phải ở đâu trong dòng cũng ra
   * menu. Chỉ ô ĐẦU nhận tiêu điểm bàn phím; các ô sau mang `tabIndex={-1}` và
   * `aria-hidden` để bàn phím với trình đọc màn hình chỉ thấy MỘT link mỗi
   * dòng, thay vì đọc lại cùng một đường dẫn chín lần.
   *
   * Đi kèm `rowLabel`: nhãn của link đầu là nội dung ô đầu, mà ô đầu thường là
   * ngày — "05/09/2026" không nói được nó dẫn tới đâu.
   */
  rowHref?: (row: T) => string;
  /** Câu đọc lên cho link của dòng. Chỉ có nghĩa khi có `rowHref`. */
  rowLabel?: (row: T) => string;
  /**
   * Bảng xếp hạng: đĩa số hạng ở cột đầu, tô nền các dòng đầu.
   *
   * Chỉ bật trên dashboard. Bảng danh sách (khách, bảo hiểm…) để trống — chúng
   * dùng chung component này nhưng không phải bảng đua hạng.
   */
  highlightTop?: number;
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
  summaryRow,
  onRowClick,
  rowHref,
  rowLabel,
  highlightTop,
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
    return [...rows].sort((a, b) =>
      asc ? sortBy(a) - sortBy(b) : sortBy(b) - sortBy(a),
    );
  }, [server, rows, columns, sortKey, asc]);

  const size = server ? server.pageSize : pageSize;
  const totalRows = server ? server.total : sorted.length;
  const pageCount = size ? Math.ceil(totalRows / size) : 1;
  const maxPage = Math.max(0, pageCount - 1);
  const current = Math.min(server ? server.page : page, maxPage);
  const visible =
    server || !pageSize
      ? sorted
      : sorted.slice(current * pageSize, (current + 1) * pageSize);

  const previousPlaces = useMemo(() => {
    if (highlightTop == null) return null;
    const col = columns.find((c) => c.key === activeSort);
    if (!col?.sortPrevious) return null;
    return rankingPlacesByValue(
      sorted.map((row) => col.sortPrevious!(row)),
      !activeAsc,
    );
  }, [highlightTop, columns, activeSort, activeAsc, sorted]);

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

  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );

  const goTo = (next: number) =>
    server ? server.onPageChange(next) : setPage(next);

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
    <div>
      <div className="table-scroll" onScroll={() => setTip(null)}>
        <table
          className={clsx(
            "table",
            styles.table,
            highlightTop != null && styles.ranked,
          )}
        >
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
                      active
                        ? activeAsc
                          ? "ascending"
                          : "descending"
                        : undefined
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
            {visible.map((row, rowIndex) => {
              const href = rowHref?.(row);
              const place =
                highlightTop != null
                  ? rankingPlace(rowIndex, current, size)
                  : undefined;
              const top = place != null && rankingHighlight(place, highlightTop);
              const offset = size ? current * size : 0;
              const delta =
                place != null
                  ? rankingDelta(place, previousPlaces?.[offset + rowIndex] ?? null)
                  : null;
              return (
                <tr
                  key={rowKey(row)}
                  data-rank={place}
                  className={clsx(
                    onRowClick || href ? styles.clickable : undefined,
                    top && styles.top,
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col, index) => {
                    let content: React.ReactNode = col.ratio ? (
                      <span className={styles.ratioCell}>
                        <span className={styles.track} aria-hidden>
                          <span
                            className={styles.fill}
                            style={{
                              width: `${Math.min(100, col.ratio(row))}%`,
                            }}
                          />
                        </span>
                        {col.render(row)}
                      </span>
                    ) : (
                      col.render(row)
                    );

                    if (place != null && index === 0) {
                      const deltaLabel = rankingDeltaLabel(delta);
                      const deltaText = rankingDeltaText(delta);
                      content = (
                        <span className={styles.identity}>
                          <span className={styles.rankMark}>
                            <span
                              className={styles.rankBadge}
                              data-place={place <= 3 ? place : undefined}
                              role="img"
                              aria-label={rankingLabel(place)}
                            >
                              {place}
                            </span>
                            {deltaText && (
                              <span
                                className={clsx(
                                  styles.rankDelta,
                                  delta != null && delta > 0
                                    ? styles.rankUp
                                    : styles.rankDown,
                                )}
                                aria-label={deltaLabel ?? undefined}
                              >
                                {deltaText}
                              </span>
                            )}
                          </span>
                          <span className={styles.identityName}>{content}</span>
                        </span>
                      );
                    }

                    const cellTitle = rankingTip(
                      place != null && index === 0 ? rankingLabel(place) : null,
                      place != null && index === 0 && delta != null && delta !== 0
                        ? rankingDeltaLabel(delta)
                        : null,
                      col.title?.(row),
                    );

                    return (
                      <td
                        key={col.key}
                        className={clsx(
                          col.align === "right" ? styles.right : undefined,
                          col.sortBy ? "tabular-nums" : undefined,
                          href ? styles.linkCell : undefined,
                          cellTitle ? styles.tipped : undefined,
                        )}
                        onPointerEnter={
                          cellTitle
                            ? (event) => {
                                const box = event.currentTarget.getBoundingClientRect();
                                setTip({
                                  text: cellTitle,
                                  x: box.left + box.width / 2,
                                  y: box.top,
                                });
                              }
                            : undefined
                        }
                        onPointerLeave={cellTitle ? () => setTip(null) : undefined}
                      >
                        {href ? (
                          <Link
                            href={href}
                            className={styles.rowLink}
                            aria-label={
                              index === 0 ? rowLabel?.(row) : undefined
                            }
                            aria-hidden={index > 0}
                            tabIndex={index > 0 ? -1 : undefined}
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {summaryRow && rows.length > 0 && (
            <tfoot>
              <tr className={styles.summaryRow}>
                {columns.map((col, index) => (
                  <td
                    key={col.key}
                    className={clsx(
                      col.align === "right" ? styles.right : undefined,
                      col.sortBy ? "tabular-nums" : undefined,
                    )}
                  >
                    {summaryRow[index] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Nằm NGOÀI `.table-scroll`: bảng rộng cuộn ngang thì thanh này đứng yên.
          Đặt bên trong là nó trôi theo cột và bị cắt mất nút "Sau". */}
      {size && pageCount > 1 && (
        <div className={styles.pager}>
          <span className={styles.range}>
            {current * size + 1}–{Math.min((current + 1) * size, totalRows)}{" "}
            trên {totalRows}
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

      {tip &&
        createPortal(
          <div
            className={styles.tip}
            role="tooltip"
            style={{ left: tip.x, top: tip.y }}
          >
            {tip.text}
          </div>,
          document.body,
        )}
    </div>
  );
}

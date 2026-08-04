import styles from "./Skeleton.module.scss";

/**
 * Khung xám thay cho nội dung đang tải.
 *
 * Dùng khung có HÌNH DÁNG GIỐNG nội dung thật thay vì một dòng chữ "Đang tải…":
 * bố cục không nhảy khi dữ liệu về, và người dùng biết trước sắp thấy bảng hay
 * thấy thẻ. Dòng chữ thì trang nào cũng như trang nào, tải xong là mọi thứ giật
 * một cái.
 *
 * Toàn bộ khối skeleton chỉ được thông báo MỘT lần cho trình đọc màn hình
 * (xem `SkeletonBlock`), từng ô con đều `aria-hidden` — đọc lên vài chục ô rỗng
 * thì tệ hơn là không đọc gì.
 */

type BoxProps = {
  /** Bề ngang, mặc định chiếm hết. Truyền `"60%"`, `"120px"`… */
  width?: string;
  height?: string;
  /** Bo tròn hẳn — dùng cho ảnh đại diện, chấm trạng thái. */
  circle?: boolean;
  className?: string;
};

export function Skeleton({ width, height, circle = false, className }: BoxProps) {
  return (
    <span
      aria-hidden
      className={[styles.box, circle && styles.circle, className].filter(Boolean).join(" ")}
      style={{ width, height }}
    />
  );
}

/**
 * Bọc ngoài mọi skeleton. Đây là chỗ DUY NHẤT nói với trình đọc màn hình rằng
 * đang tải, và `aria-busy` để phần mềm hỗ trợ biết vùng này sắp thay đổi.
 */
export function SkeletonBlock({
  label = "Đang tải nội dung",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.block} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Mấy dòng chữ. Dòng cuối ngắn hơn cho giống đoạn văn thật. */
export function SkeletonText({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <SkeletonBlock label={label}>
      <div className={styles.textLines}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} height="13px" width={i === lines - 1 ? "62%" : undefined} />
        ))}
      </div>
    </SkeletonBlock>
  );
}

/**
 * Khung của một bảng: hàng tiêu đề rồi tới các dòng.
 *
 * `columns` nên khớp số cột thật của bảng sắp hiện — lệch số cột thì lúc dữ
 * liệu về bố cục vẫn nhảy, đúng thứ skeleton sinh ra để tránh.
 */
export function SkeletonTable({
  rows = 6,
  columns = 4,
  label = "Đang tải bảng",
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <SkeletonBlock label={label}>
      <div className={styles.table} style={{ "--cols": columns } as React.CSSProperties}>
        <div className={`${styles.row} ${styles.head}`}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} height="11px" width="58%" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className={styles.row}>
            {Array.from({ length: columns }, (_, c) => (
              // Cột đầu là tên nên dài hơn; các cột sau là số nên ngắn lại.
              <Skeleton key={c} height="13px" width={c === 0 ? "80%" : "45%"} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonBlock>
  );
}

/** Hàng thẻ số liệu ở đầu các trang danh sách. */
export function SkeletonStats({ count = 3, label = "Đang tải số liệu" }: { count?: number; label?: string }) {
  return (
    <SkeletonBlock label={label}>
      <div className={styles.stats} style={{ "--cols": count } as React.CSSProperties}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={styles.statCard}>
            <Skeleton height="26px" width="52%" />
            <Skeleton height="11px" width="72%" />
          </div>
        ))}
      </div>
    </SkeletonBlock>
  );
}

/** Khung một thẻ nội dung — dùng cho cột bên của các trang chi tiết. */
export function SkeletonCard({ lines = 4, label = "Đang tải" }: { lines?: number; label?: string }) {
  return (
    <SkeletonBlock label={label}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <Skeleton width="34px" height="34px" circle />
          <div className={styles.cardHeadText}>
            <Skeleton height="14px" width="58%" />
            <Skeleton height="11px" width="38%" />
          </div>
        </div>
        <div className={styles.textLines}>
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton key={i} height="12px" width={i === lines - 1 ? "55%" : undefined} />
          ))}
        </div>
      </div>
    </SkeletonBlock>
  );
}

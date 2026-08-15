import { clsx } from "clsx";
import styles from "./ProgressRing.module.css";

export type RingSegment = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  /** Các phần cộng lại thành tổng. Một phần tử thì vòng liền một khối. */
  segments: RingSegment[];
  max: number;
  /** Tên chỉ số cho trình đọc màn hình. */
  ariaLabel: string;
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Vòng tiến độ chia phần, số tổng ở giữa.
 *
 * Vẽ bằng `stroke` trong CSS chứ không phải thuộc tính SVG — thuộc tính SVG
 * không giải được `var(--om-*)`. Riêng màu từng phần thì buộc phải là mã màu
 * thật vì nó đến từ dữ liệu, lấy ở `SERIES_RAMP`.
 */
export function ProgressRing({ segments, max, ariaLabel }: Props) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  // Hệ số là `numeric(4,2)` nên tổng là số thực nhị phân: 1.4 + 1.4 + 1.4 ra
  // 4.199999999999999, và React in nguyên chuỗi đó vào giữa vòng. Giữ `total`
  // thô cho phần hình học, chỉ làm tròn cái đọc được.
  const shown = Math.round(total * 100) / 100;
  const reached = total >= max;

  // Vượt chỉ tiêu thì co các phần lại cho vừa đúng một vòng; nếu không cung
  // cuối cùng chạy chồng lên cung đầu và vòng trông như còn thiếu.
  const scale = max > 0 ? Math.min(1, max / Math.max(total, 1)) / max : 0;

  let offset = 0;

  return (
    <div
      className={styles.ring}
      role="progressbar"
      aria-valuenow={shown}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel}
    >
      <svg viewBox="0 0 120 120" className={styles.svg} aria-hidden focusable="false">
        <circle className={styles.track} cx="60" cy="60" r={RADIUS} />
        {segments.map((s) => {
          const length = s.value * scale * CIRCUMFERENCE;
          const start = offset;
          offset += length;
          return (
            <circle
              key={s.label}
              className={styles.arc}
              cx="60"
              cy="60"
              r={RADIUS}
              stroke={s.color}
              strokeDasharray={`${length} ${CIRCUMFERENCE}`}
              strokeDashoffset={-start}
            />
          );
        })}
      </svg>

      <span className={styles.center}>
        <strong
          className={clsx(styles.value, reached && styles.reached, "tabular-nums")}
        >
          {shown}
        </strong>
        <span className={`${styles.max} so`}>/ {max}</span>
      </span>
    </div>
  );
}

import styles from "./ProgressRing.module.css";

type Props = {
  value: number;
  max: number;
  /** Tên chỉ số cho trình đọc màn hình. */
  ariaLabel: string;
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Vòng tiến độ có số ở giữa.
 *
 * Vẽ bằng `stroke` trong CSS chứ không phải thuộc tính SVG — thuộc tính SVG
 * không giải được `var(--om-*)`, đặt màu ở đó là màu chết cứng.
 */
export function ProgressRing({ value, max, ariaLabel }: Props) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const reached = value >= max;

  return (
    <div
      className={styles.ring}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel}
    >
      <svg viewBox="0 0 120 120" className={styles.svg} aria-hidden focusable="false">
        <circle className={styles.track} cx="60" cy="60" r={RADIUS} />
        <circle
          className={reached ? styles.fillReached : styles.fill}
          cx="60"
          cy="60"
          r={RADIUS}
          style={{
            strokeDasharray: CIRCUMFERENCE,
            strokeDashoffset: CIRCUMFERENCE * (1 - ratio),
          }}
        />
      </svg>

      <span className={styles.center}>
        <strong className={`${styles.value} so`}>{value}</strong>
        <span className={`${styles.max} so`}>/ {max}</span>
      </span>
    </div>
  );
}

import styles from "./KpiHighlight.module.css";

type Props = {
  /** Nhãn nhỏ phía trên. Bỏ trống thì không hiện. */
  kicker?: string;
  /** Tên chỉ số cho trình đọc màn hình — thanh tiến trình cần nó. */
  ariaLabel: string;
  /** Giá trị phần trăm, 0–100. Dùng luôn cho thanh tiến trình. */
  percent: number;
  description: React.ReactNode;
  detail: React.ReactNode;
  /**
   * So với kỳ trước, nằm bên phải chân thẻ. Tăng thì xanh, giảm thì đỏ.
   * Bỏ trống khi không có kỳ nào để so.
   */
  delta?: { text: string; up: boolean };
};

/** Thẻ chỉ số chính trên dashboard — số lớn kèm thanh tiến trình. */
export function KpiHighlight({
  kicker,
  ariaLabel,
  percent,
  description,
  detail,
  delta,
}: Props) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className={styles.card}>
      {kicker && <span className={styles.kicker}>{kicker}</span>}

      <div className={styles.headline}>
        <strong className={`${styles.value} so`}>{clamped}%</strong>
        <span className={styles.description}>{description}</span>

        <span className={styles.icon} aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
            <rect
              x="7"
              y="2.5"
              width="10"
              height="19"
              rx="2.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M10.6 18.4h2.8"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>

      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <span className={styles.fill} style={{ width: `${clamped}%` }} />
      </div>

      <div className={styles.foot}>
        <span className={styles.detail}>{detail}</span>
        {delta && (
          <span className={delta.up ? styles.deltaUp : styles.deltaDown}>
            {delta.text}
          </span>
        )}
      </div>
    </div>
  );
}

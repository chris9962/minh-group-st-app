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
};

/** Thẻ chỉ số chính trên dashboard — số lớn kèm thanh tiến trình. */
export function KpiHighlight({
  kicker,
  ariaLabel,
  percent,
  description,
  detail,
}: Props) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className={styles.card}>
      {kicker && <span className={styles.kicker}>{kicker}</span>}

      <div className={styles.headline}>
        <strong className={`${styles.value} so`}>{clamped}%</strong>
        <span className={styles.description}>{description}</span>
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

      <span className={styles.detail}>{detail}</span>
    </div>
  );
}

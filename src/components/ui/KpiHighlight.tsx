import styles from "./KpiHighlight.module.css";

type Props = {
  kicker: string;
  /** Giá trị phần trăm, 0–100. Dùng luôn cho thanh tiến trình. */
  percent: number;
  description: React.ReactNode;
  detail: React.ReactNode;
};

/** Thẻ chỉ số chính trên dashboard — số lớn kèm thanh tiến trình. */
export function KpiHighlight({ kicker, percent, description, detail }: Props) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className={styles.card}>
      <span className={styles.kicker}>{kicker}</span>

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
        aria-label={kicker}
      >
        <span className={styles.fill} style={{ width: `${clamped}%` }} />
      </div>

      <span className={styles.detail}>{detail}</span>
    </div>
  );
}

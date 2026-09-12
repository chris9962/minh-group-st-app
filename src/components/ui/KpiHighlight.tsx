import { Smartphone } from "lucide-react";
import styles from "./KpiHighlight.module.scss";

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
  /**
   * Tỉ lệ riêng của từng phần, mỗi dòng một thanh nhỏ dưới thanh tổng. `color`
   * là màu nhận diện của phần đó, thanh tổng vẫn màu nhấn.
   */
  rows?: { label: string; percent: number; detail: string; color: string }[];
};

const clamp = (percent: number) => Math.max(0, Math.min(100, percent));

/** Thẻ chỉ số chính trên dashboard — số lớn kèm thanh tiến trình. */
export function KpiHighlight({
  kicker,
  ariaLabel,
  percent,
  description,
  detail,
  delta,
  rows,
}: Props) {
  const clamped = clamp(percent);

  return (
    <div className={styles.card}>
      {kicker && <span className={styles.kicker}>{kicker}</span>}

      <div className={styles.headline}>
        <strong className={`${styles.value} so`}>{clamped}%</strong>
        <span className={styles.description}>{description}</span>

        <span className={styles.icon} aria-hidden>
          <Smartphone size={20} strokeWidth={1.8} />
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

      {rows && rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.label} className={styles.row}>
              <span className={styles.rowLabel}>{row.label}</span>
              {/* Thanh chỉ minh hoạ, số phần trăm ngay cạnh đã nói đủ. */}
              <span className={styles.rowTrack} aria-hidden>
                <span
                  className={styles.rowFill}
                  style={{ width: `${clamp(row.percent)}%`, background: row.color }}
                />
              </span>
              <span className={`${styles.rowPercent} tabular-nums`}>{clamp(row.percent)}%</span>
              <span className={`${styles.rowDetail} tabular-nums`}>{row.detail}</span>
            </li>
          ))}
        </ul>
      )}

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

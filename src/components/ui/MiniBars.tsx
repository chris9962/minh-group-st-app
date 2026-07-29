import styles from "./MiniBars.module.css";

export type MiniBarRow = {
  label: string;
  value: number;
};

type Props = {
  rows: MiniBarRow[];
  /** Nhãn của cột cần làm nổi, thường là mốc đang xem. */
  highlight?: string;
  caption: string;
};

/**
 * Dãy cột nhỏ, không trục không lưới.
 *
 * Cố ý KHÔNG dùng recharts như `BarChart`: ở đây chỉ có 5 cột trong một cột hẹp,
 * không cần trục dọc, đường lưới hay chú thích. Kéo cả thư viện vào chỉ để vẽ
 * 5 hình chữ nhật thì phần chú thích và trục thừa ra chiếm hết chỗ.
 */
export function MiniBars({ rows, highlight, caption }: Props) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className={styles.wrap}>
      <div className={styles.bars} aria-hidden>
        {rows.map((r) => (
          <div key={r.label} className={styles.col}>
            <div
              className={[styles.bar, r.label === highlight && styles.on]
                .filter(Boolean)
                .join(" ")}
              style={{ height: `${Math.max(4, (r.value / max) * 100)}%` }}
            />
            <span className={styles.label}>{r.label}</span>
          </div>
        ))}
      </div>

      <table className="an-nhin">
        <caption>{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

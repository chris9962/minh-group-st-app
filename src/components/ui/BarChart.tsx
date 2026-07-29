import styles from "./BarChart.module.css";

export type BarSeries = { label: string; color: string };

type Props = {
  rows: { label: string; values: number[] }[];
  series: BarSeries[];
  caption: string;
};

/**
 * Biểu đồ cột chồng, dựng bằng CSS.
 *
 * Không dùng thư viện vẽ biểu đồ cho hình đơn giản thế này — thêm ~50KB mà
 * không giúp gì. Giá trị luôn hiện bằng SỐ ở bảng ẩn phía dưới để trình đọc
 * màn hình đọc được, vì cột màu không đọc được.
 */
export function BarChart({ rows, series, caption }: Props) {
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));

  return (
    <div className={styles.wrap}>
      <div className={styles.legend}>
        {series.map((s) => (
          <span key={s.label} className={styles.legendItem}>
            <i style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>

      <div className={styles.chart} aria-hidden>
        {rows.map((row) => (
          <div key={row.label} className={styles.column}>
            <div className={styles.stack}>
              {row.values.map((v, i) => (
                <div
                  key={series[i].label}
                  className={styles.bar}
                  style={{
                    height: `${(v / max) * 100}%`,
                    background: series[i].color,
                  }}
                />
              ))}
            </div>
            <span className={styles.tick}>{row.label}</span>
          </div>
        ))}
      </div>

      <table className="an-nhin">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Khung giờ</th>
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((v, i) => (
                <td key={series[i].label}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

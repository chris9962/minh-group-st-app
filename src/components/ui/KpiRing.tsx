import styles from "./KpiRing.module.scss";

type Props = {
  value: number;
  target: number;
  /** Câu đầy đủ hiện khi di chuột và đọc lên cho trình đọc màn hình. */
  detail: string;
};

const SIZE = 26;
const STROKE = 3.5;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Vòng tiến độ nhỏ cho ô bảng: đạt bao nhiêu phần chỉ tiêu.
 *
 * Màu chạy từ CAM sang XANH theo mức độ tiến gần chỉ tiêu, trộn bằng
 * `color-mix` giữa đúng hai token có sẵn — không đẻ thêm màu mới. Đây là hai
 * màu MANG NGHĨA của hệ thống ("chưa đạt" và "đạt"), không phải màu trang trí.
 *
 * Kênh truyền đạt chính là ĐỘ DÀI CUNG, không phải màu: vòng rỗng và vòng đầy
 * phân biệt được kể cả khi in đen trắng, màu chỉ nhấn thêm. Con số chính xác
 * nằm ở tooltip khi rê chuột, và câu đầy đủ nằm trong `aria-label` cho trình
 * đọc màn hình — nên bỏ con số cạnh vòng không làm mất thông tin của ai.
 */
export function KpiRing({ value, target, detail }: Props) {
  const ratio = target > 0 ? value / target : 0;
  const filled = Math.min(1, Math.max(0, ratio));

  return (
    <span className={styles.wrap}>
      <span className={styles.cell} tabIndex={0} role="img" aria-label={detail}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <circle
            className={styles.track}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            strokeWidth={STROKE}
            fill="none"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            strokeWidth={STROKE}
            fill="none"
            // `round` ở độ dài 0 vẫn vẽ ra một chấm tròn, nên 0 điểm trông như
            // đã nhích được một tí. Chỉ bo đầu khi thật sự có tiến độ.
            strokeLinecap={filled > 0 ? "round" : "butt"}
            strokeDasharray={`${filled * C} ${C}`}
            // Bắt đầu từ 12 giờ chứ không phải 3 giờ — đọc tiến độ theo chiều
            // kim đồng hồ là phản xạ tự nhiên.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{
              stroke: `color-mix(in oklab, var(--om-green) ${Math.round(filled * 100)}%, var(--om-orange))`,
            }}
          />
        </svg>
      </span>

      {/* Chi tiết chỉ là phần thêm cho chuột và bàn phím; nội dung của nó đã có
          sẵn trong aria-label nên trình đọc màn hình bỏ qua để khỏi nghe hai lần. */}
      <span className={styles.tip} aria-hidden>
        {detail}
      </span>
    </span>
  );
}

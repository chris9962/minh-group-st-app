/**
 * Màu chuỗi cho biểu đồ.
 *
 * ⚠️ Bắt buộc là mã màu thật, KHÔNG dùng được `var(--om-*)`: recharts ghi màu
 * thành thuộc tính `fill` của SVG, mà thuộc tính SVG không giải biến CSS.
 *
 * Hai giá trị này phải khớp với `--om-orange` và `--om-orange-2` trong
 * `styles/organic.css`. Đổi token thì đổi luôn ở đây.
 */
export const CHART_COLORS = {
  primary: '#e8763a',
  secondary: '#a84a05',
  /** Cột bị làm mờ khi chỉ một cột được làm nổi — khớp `--om-line`. */
  muted: '#e4e3e1',
} as const;

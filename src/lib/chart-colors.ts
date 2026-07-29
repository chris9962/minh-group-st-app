import { useTheme } from '@/store/theme';

/**
 * Màu cho biểu đồ.
 *
 * ⚠️ Bắt buộc là mã màu thật, KHÔNG dùng được `var(--om-*)`: recharts ghi màu
 * thành thuộc tính `fill` của SVG, mà thuộc tính SVG không giải biến CSS. Đó là
 * lý do phải khai hai bộ ở đây thay vì để CSS lo như mọi chỗ khác.
 *
 * Giá trị phải khớp `--om-orange`, `--om-orange-2` và `--om-line` của từng bộ
 * trong `styles/organic.css`. Đổi token thì đổi luôn ở đây.
 */
export type ChartColors = {
  primary: string;
  secondary: string;
  /** Cột bị làm mờ khi chỉ một cột được làm nổi. */
  muted: string;
};

const LIGHT: ChartColors = {
  primary: '#d95328',
  secondary: '#e88055',
  muted: '#ebe5dc',
};

const DARK: ChartColors = {
  primary: '#f97316',
  secondary: '#fb923c',
  muted: '#26344a',
};

/** Bộ sáng — dùng cho chỗ không gọi hook được. */
export const CHART_COLORS = LIGHT;

export function useChartColors(): ChartColors {
  return useTheme((s) => s.theme) === 'dark' ? DARK : LIGHT;
}

/**
 * Màu cố định cho từng nguồn điểm.
 *
 * Ngân hàng lấy màu nhận diện của chính ngân hàng đó — đây là NGOẠI LỆ duy nhất
 * của bảng màu, vì màu ở đây là danh tính của bên thứ ba chứ không phải màu
 * trang trí. Không đổi theo bộ sáng / tối: màu nhận diện thì ở đâu cũng vậy.
 *
 * Cùng một ngân hàng có hai mã (VPa/VPb) thì dùng hai sắc độ của cùng một màu.
 * Thêm ngân hàng mới mà quên thêm ở đây thì rơi xuống dải dự phòng bên dưới —
 * không vỡ, chỉ là không nhận ra ngay.
 */
export const SOURCE_COLORS: Record<string, string> = {
  MSBa: '#e11b22',
  MSBb: '#f4767a',
  VPa: '#00a651',
  VPb: '#5cc98f',
  MB: '#1a4b8c',
  TPB: '#6d2e8f',
  'Dịch vụ': '#d95328',
};

/** Nguồn chưa có màu riêng. Xen kẽ sáng · đậm để hai cung cạnh nhau không dính. */
const FALLBACK_COLORS = ['#d95328', '#963317', '#e88055', '#bf4420'];

export const sourceColor = (label: string, index: number): string =>
  SOURCE_COLORS[label] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];

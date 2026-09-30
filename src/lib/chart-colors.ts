import { useTheme, type Accent } from '@/store/theme';

/**
 * Màu cho biểu đồ.
 *
 * ⚠️ Bắt buộc là mã màu thật, KHÔNG dùng được `var(--om-*)`: recharts ghi màu
 * thành thuộc tính `fill` của SVG, mà thuộc tính SVG không giải biến CSS. Đó là
 * lý do phải khai hai bộ ở đây thay vì để CSS lo như mọi chỗ khác.
 *
 * Giá trị phải khớp `--om-orange`, `--om-orange-2` và `--om-line` của từng bộ
 * trong `styles/organic.css`, các màu chủ đạo khác khớp `app/globals.css`. Đổi token
 * thì đổi luôn ở đây.
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

const BLUE_LIGHT: ChartColors = {
  primary: '#1d4ed8',
  secondary: '#60a5fa',
  muted: '#ebe5dc',
};

const BLUE_DARK: ChartColors = {
  primary: '#60a5fa',
  secondary: '#93c5fd',
  muted: '#26344a',
};

const CYAN_LIGHT: ChartColors = {
  primary: '#0e7490',
  secondary: '#22d3ee',
  muted: '#ebe5dc',
};

const CYAN_DARK: ChartColors = {
  primary: '#22d3ee',
  secondary: '#67e8f9',
  muted: '#26344a',
};

const PINK_LIGHT: ChartColors = {
  primary: '#be185d',
  secondary: '#f472b6',
  muted: '#ebe5dc',
};

const PINK_DARK: ChartColors = {
  primary: '#f472b6',
  secondary: '#f9a8d4',
  muted: '#26344a',
};

const SLATE_LIGHT: ChartColors = {
  primary: '#334155',
  secondary: '#94a3b8',
  muted: '#ebe5dc',
};

const SLATE_DARK: ChartColors = {
  primary: '#e2e8f0',
  secondary: '#94a3b8',
  muted: '#26344a',
};

const BY_ACCENT: Record<Accent, { light: ChartColors; dark: ChartColors }> = {
  orange: { light: LIGHT, dark: DARK },
  blue: { light: BLUE_LIGHT, dark: BLUE_DARK },
  cyan: { light: CYAN_LIGHT, dark: CYAN_DARK },
  pink: { light: PINK_LIGHT, dark: PINK_DARK },
  slate: { light: SLATE_LIGHT, dark: SLATE_DARK },
};

/** Bộ sáng — dùng cho chỗ không gọi hook được. */
export const CHART_COLORS = LIGHT;

export function useChartColors(): ChartColors {
  const dark = useTheme((s) => s.theme) === 'dark';
  // localStorage có thể còn giá trị lạ từ bản khác, nên không tin kiểu Accent.
  const set = BY_ACCENT[useTheme((s) => s.accent)] ?? BY_ACCENT.orange;
  return dark ? set.dark : set.light;
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

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

/**
 * Màu cố định cho từng nguồn điểm.
 *
 * Ngân hàng lấy màu nhận diện của chính ngân hàng đó — đây là NGOẠI LỆ duy nhất
 * của bảng màu xám · trắng · cam, vì màu ở đây là danh tính của bên thứ ba chứ
 * không phải màu trang trí. Bám màu thật thì người dùng nhìn cung là biết ngân
 * hàng nào, không phải dò chú thích.
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
  'Dịch vụ': '#e8763a',
};

/** Nguồn chưa có màu riêng. Xen kẽ sáng · đậm để hai cung cạnh nhau không dính. */
const FALLBACK_COLORS = ['#e8763a', '#8a3d05', '#f2a077', '#b04d06'];

export const sourceColor = (label: string, index: number): string =>
  SOURCE_COLORS[label] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];

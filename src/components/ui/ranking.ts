/** Số hạng người dùng thấy trên bảng: trang 0, dòng 0 = 1. */
export function rankingPlace(
  rowIndex: number,
  page = 0,
  pageSize?: number,
): number {
  return (pageSize ? page * pageSize : 0) + rowIndex + 1;
}

/**
 * Tô nền các dòng đầu. Tắt khi không có `highlightTop` — bảng danh sách không
 * phải bảng xếp hạng.
 */
export function rankingHighlight(
  place: number,
  highlightTop: number | undefined,
): boolean {
  return highlightTop != null && place <= highlightTop;
}

/** Số trên đĩa không đủ: trình đọc màn hình cần nghe "Hạng 1", không phải "1". */
export function rankingLabel(place: number): string {
  return `Hạng ${place}`;
}

/**
 * Chênh hạng: dương là lên, âm là xuống. `previousPlace` null khi không có kỳ
 * trước để so — không bịa mũi tên.
 */
export function rankingDelta(
  currentPlace: number,
  previousPlace: number | null,
): number | null {
  if (previousPlace == null) return null;
  return previousPlace - currentPlace;
}

/** Hạng kỳ trước theo giá trị đã so, cùng chiều với bảng đang xem. */
export function rankingPlacesByValue(
  values: (number | null)[],
  descending: boolean,
): (number | null)[] {
  const indexed = values
    .map((value, index) => ({ value, index }))
    .filter((row): row is { value: number; index: number } => row.value != null);
  indexed.sort((a, b) => (descending ? b.value - a.value : a.value - b.value));
  const places: (number | null)[] = values.map(() => null);
  indexed.forEach((row, rank) => {
    places[row.index] = rank + 1;
  });
  return places;
}

export function rankingDeltaLabel(delta: number | null): string | null {
  if (delta == null) return null;
  if (delta === 0) return "Không đổi hạng";
  if (delta > 0) return `Lên ${delta} hạng`;
  return `Xuống ${Math.abs(delta)} hạng`;
}

/** Chữ cạnh đĩa hạng: `+1` / `−1`. Không ghi khi đứng yên — tránh nhìn như số hạng thứ hai. */
export function rankingDeltaText(delta: number | null): string | null {
  if (delta == null || delta === 0) return null;
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

/** Thanh tỉ lệ: phần của TỔNG bảng, không phải so với phòng dẫn đầu. */
export function rankingShare(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

/** Câu hover/đọc lên cho thanh tỉ lệ: số phòng trên tổng, kèm phần trăm. */
export function rankingShareTitle(
  value: number,
  total: number,
  unit: string,
): string {
  if (total <= 0) return `${value} ${unit}`;
  return `${value} trên ${total} ${unit}, ${rankingShare(value, total)}%`;
}

/**
 * Ghép các mảnh tooltip, bỏ chỗ trống. MỖI MẢNH MỘT DÒNG — `.tip` đã để
 * `white-space: pre-wrap`.
 *
 * Bản trước nối bằng dấu chấm giữa thành một dòng dài, nên tooltip cột Tăng
 * trưởng gộp phần trăm với bảy con số của bảy ngày vào cùng một câu.
 */
export function rankingTip(
  ...parts: (string | null | undefined)[]
): string | null {
  const text = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
  return text || null;
}

/** Số cột sparkline tăng trưởng trong bảng xếp hạng — một tuần, không bịa. */
export const SPARKLINE_DAYS = 7;

/** Các ngày `YYYY-MM-DD` kết thúc đúng `to`, đủ `count` ngày, cũ → mới. */
export function daysEndingOn(to: string, count: number): string[] {
  const [year, month, day] = to.split("-").map(Number);
  const end = Date.UTC(year, month - 1, day);
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * % tăng tài khoản mở so với kỳ trước. `null` khi không so được: không có kỳ
 * trước, hoặc kỳ trước = 0 mà kỳ này > 0 (chia cho 0).
 */
export function growthPercent(
  current: number,
  previous: number | null,
): number | null {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Chiều cao cột 0–100 theo max của CHÍNH dãy — mỗi dòng tự scale. */
export function sparklineHeights(values: number[]): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((value) => Math.round((value / max) * 100));
}

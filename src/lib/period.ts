/**
 * Kỳ số liệu dùng chung: chuỗi `PeriodPicker` gửi lên và khoảng ngày máy chủ
 * mở ra. Một hàm, hai đầu — client vẽ nhãn, server lọc SQL.
 *
 * Cửa sổ 3/6/12 tháng là tháng lịch trọn, kể cả tháng đang chạy. Kỳ trước là
 * đúng bằng số tháng liền trước — khoảng ngày tự chọn thì không có kỳ trước.
 */
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { monthRange } from "./format";

export type DateSpan = { from: string; to: string };

export type PeriodKind =
  | "today"
  | "this-month"
  | "last-3-months"
  | "last-6-months"
  | "last-1-year"
  | "range";

/**
 * Hai preset trên Tổng quan; bỏ 3 tháng, 6 tháng, 1 năm (chốt 2026-09-25).
 * Khoảng tự chọn đi bằng lịch, nhãn thành Custom, và nằm trọn trong một tháng.
 */
export const OVERVIEW_PERIOD_KINDS: readonly PeriodKind[] = ["today", "this-month"];

/** Màn phòng ban vẫn cho chọn khoảng ngày trong một tháng. */
export const FILTER_PERIOD_KINDS: readonly PeriodKind[] = ["today", "this-month", "range"];

const MONTH_WINDOWS: Record<string, number> = {
  "last-3-months": 3,
  "last-6-months": 6,
  "last-1-year": 12,
};

const dayBefore = (day: string): string =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

/** Lùi/tiến tháng, giữ dạng `YYYY-MM`. */
export const shiftMonth = (yearMonth: string, delta: number): string => {
  const [y, m] = yearMonth.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
};

const calendarMonths = (today: string, count: number): DateSpan => {
  const endMonth = today.slice(0, 7);
  const startMonth = shiftMonth(endMonth, -(count - 1));
  return { from: monthRange(startMonth).from, to: monthRange(endMonth).to };
};

const previousCalendarMonths = (today: string, count: number): DateSpan => {
  const endMonth = shiftMonth(today.slice(0, 7), -count);
  const startMonth = shiftMonth(endMonth, -(count - 1));
  return { from: monthRange(startMonth).from, to: monthRange(endMonth).to };
};

/**
 * Đọc chuỗi kỳ: `today` · `this-month` · `last-3-months` · `last-6-months` ·
 * `last-1-year` · `range:từ:đến`. Chuỗi lạ rơi về `today`.
 */
export function periodRanges(
  key: string,
  today: string,
): { current: DateSpan; previous: DateSpan | null } {
  if (key === "this-month") {
    const month = today.slice(0, 7);
    return {
      current: monthRange(month),
      previous: monthRange(shiftMonth(month, -1)),
    };
  }

  const window = MONTH_WINDOWS[key];
  if (window) {
    return {
      current: calendarMonths(today, window),
      previous: previousCalendarMonths(today, window),
    };
  }

  const picked = key.match(/^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (picked) return { current: { from: picked[1], to: picked[2] }, previous: null };

  const yesterday = dayBefore(today);
  return { current: { from: today, to: today }, previous: { from: yesterday, to: yesterday } };
}

export function periodKindLabel(kind: PeriodKind): string {
  if (kind === "today") return "Hôm nay";
  if (kind === "this-month") return "Tháng này";
  if (kind === "last-3-months") return "3 tháng";
  if (kind === "last-6-months") return "6 tháng";
  if (kind === "last-1-year") return "1 năm";
  return "Khoảng ngày";
}

/** Nhãn kỳ đem so — `null` khi khoảng tự chọn, vì không định nghĩa được kỳ trước. */
export function previousPeriodLabel(kind: PeriodKind): string | null {
  if (kind === "today") return "hôm qua";
  if (kind === "this-month") return "tháng trước";
  if (kind === "last-3-months") return "3 tháng trước";
  if (kind === "last-6-months") return "6 tháng trước";
  if (kind === "last-1-year") return "năm trước";
  return null;
}

/** Nhãn viết thường gắn vào câu "tài khoản mở …". */
export function periodNarrativeLabel(kind: PeriodKind): string {
  if (kind === "today") return "hôm nay";
  if (kind === "this-month") return "tháng này";
  if (kind === "last-3-months") return "3 tháng";
  if (kind === "last-6-months") return "6 tháng";
  if (kind === "last-1-year") return "1 năm";
  return "khoảng đã chọn";
}

/**
 * Dịch từ vựng `PeriodPicker` sang từ vựng hồ sơ nhân viên:
 * `today` · `YYYY-MM` · `range:từ:đến`.
 */
export function toPersonPeriod(key: string, today: string): string {
  if (key === "today" || key === "") return "today";
  if (key === "this-month") return today.slice(0, 7);
  const { current } = periodRanges(key, today);
  if (key.startsWith("range:")) return key;
  return `range:${current.from}:${current.to}`;
}

const parseDay = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/** Viên thuốc khoảng ngày trên thanh trên — cùng dáng chip lịch cũ. */
export function formatPeriodChip(from: string, to: string): string {
  const start = parseDay(from);
  const end = parseDay(to);
  const opts = { locale: vi };
  if (from === to) return format(start, "dd MMM, yyyy", opts);
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "dd MMM", opts)} - ${format(end, "dd MMM, yyyy", opts)}`;
  }
  return `${format(start, "dd MMM, yyyy", opts)} - ${format(end, "dd MMM, yyyy", opts)}`;
}

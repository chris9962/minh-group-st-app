import { BUSINESS_TIMEZONE } from "@/lib/format";

/**
 * Mốc hiệu lực gửi lên PVI — tính từ hai cột `date` của đơn cộng giờ chạy.
 *
 * Database chỉ lưu NGÀY (`start_date`, `end_date` kiểu `date`), PVI đòi cả giờ.
 * Không thêm cột giờ: giờ sinh ra lúc gọi API theo đúng hai luật dưới đây.
 *
 *   giờ bắt đầu   =  giờ chạy cộng N phút
 *   mốc kết thúc  =  mốc bắt đầu dời sang `end_date`, rồi TRỪ MỘT PHÚT
 *
 * Luật thứ hai đọc từ đơn đã cấp thật `26/21/14/TNCN/0099106`
 * (`26/08/2026 8:00` → `26/08/2027 7:59`) và từ request mẫu mục 11
 * (`23/09/2025 00:00` → `22/09/2026 23:59`). Trừ một phút cho hợp đồng đúng
 * tròn N năm thay vì tròn N năm cộng một phút.
 *
 * ⚠️ Trừ một phút phải làm trên MỐC ĐẦY ĐỦ, không phải trên riêng chuỗi giờ.
 * Giờ bắt đầu `00:00` thì giờ kết thúc là `23:59` của NGÀY HÔM TRƯỚC — đúng
 * hình dạng request mẫu của PVI. Cắt riêng phần giờ thì ra `00:00` → `23:59`
 * cùng ngày, dài hơn một năm gần trọn một ngày.
 *
 * Vì sao cộng N phút: form web của PVI từ chối đơn có giờ hiệu lực đã qua. Bot
 * Playwright cộng 20 phút cho xe máy và 10 phút cho tai nạn hộ sử dụng điện.
 * API có từ chối như vậy không thì chưa biết, nhưng giữ cùng cách cho hai
 * đường ra cùng một kết quả.
 */

export type PviPeriod = {
  /** `dd/MM/yyyy` */
  startDate: string;
  /** `HH:mm` */
  startTime: string;
  endDate: string;
  endTime: string;
};

/**
 * Phút trong ngày của thời điểm `at`, đọc theo giờ Việt Nam.
 *
 * Máy chủ chạy UTC nên KHÔNG dùng `getHours()`: từ 0h đến 7h sáng giờ Việt Nam
 * nó trả về giờ của ngày hôm trước.
 */
function minutesOfDay(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `en-GB` trả `24` cho nửa đêm; quy về 0 để phép cộng phút không nhảy một ngày.
  return (get("hour") % 24) * 60 + get("minute");
}

/**
 * `YYYY-MM-DD` cộng N phút, trả về mốc dạng UTC.
 *
 * Cố ý dựng bằng `Date.UTC`: mọi phép cộng trừ ở đây là số học TRÊN LỊCH, không
 * phải trên trục thời gian thật. Dùng `new Date(y, m, d)` là kéo giờ máy chủ
 * vào, và cùng một đơn ra hai kết quả trên hai máy khác múi giờ.
 */
function calendarAt(isoDate: string, minutes: number): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Ngày phải dạng YYYY-MM-DD, nhận "${isoDate}"`);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes));
}

const pad = (n: number) => String(n).padStart(2, "0");
const asDate = (at: Date) =>
  `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`;
const asTime = (at: Date) => `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;

export function pviPeriod(opts: {
  /** `YYYY-MM-DD` — cột `insurance_orders.start_date`. */
  startDate: string;
  /** `YYYY-MM-DD` — cột `insurance_orders.end_date`. */
  endDate: string;
  /** Số phút cộng vào giờ chạy để ra giờ hiệu lực. */
  minutesAhead: number;
  /** Truyền vào để test; mặc định là lúc gọi. */
  now?: Date;
}): PviPeriod {
  /**
   * `% 1440` để phép cộng chỉ đổi GIỜ, không đổi NGÀY.
   *
   * Gọi lúc 23:50 mà cộng 20 phút thì ra 00:10 — giữ nguyên `start_date`, đúng
   * cách bot Playwright làm. Không `% 1440` thì ngày hiệu lực của đơn nhảy sang
   * hôm sau, và một đơn hẹn ngày ở tương lai cũng bị dời theo.
   */
  const timeOfDay = (minutesOfDay(opts.now ?? new Date()) + opts.minutesAhead) % 1440;

  const start = calendarAt(opts.startDate, timeOfDay);
  // Cùng giờ với mốc bắt đầu, đặt lên `end_date`, rồi lùi một phút. Giờ bắt đầu
  // `00:00` thì phép trừ này lùi sang `23:59` NGÀY HÔM TRƯỚC — đúng hình dạng
  // request mẫu mục 11 của PVI.
  const end = calendarAt(opts.endDate, timeOfDay - 1);

  if (end.getTime() <= start.getTime())
    throw new Error(
      `Mốc kết thúc không sau mốc bắt đầu: ${opts.startDate} → ${opts.endDate}`,
    );

  return {
    startDate: asDate(start),
    startTime: asTime(start),
    endDate: asDate(end),
    endTime: asTime(end),
  };
}

/** Xe máy gộp ngày và giờ vào MỘT chuỗi; tai nạn điện tách hai field. */
export const asDateTime = (date: string, time: string) => `${date} ${time}`;

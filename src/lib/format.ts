/** Chuẩn hoá & định dạng dữ liệu — dùng chung cho hiển thị, tìm kiếm và xuất Excel. */

/**
 * Bỏ dấu tiếng Việt.
 *
 * NFD tách được dấu của nguyên âm nhưng KHÔNG tách đ/Đ — phải thay tay,
 * nếu không `Đặng` ra `ĐANG` thay vì `DANG` và ngân hàng trả file về.
 */
export function removeDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Khoá tìm kiếm: thường hoá + bỏ dấu + gộp khoảng trắng. */
export function searchKey(input: string): string {
  return removeDiacritics(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Tìm không dấu, không phân biệt thứ tự từ.
 * `bich tram nguyen` vẫn khớp `Nguyễn Thị Bích Trâm`.
 */
export function matchesSearch(source: string, query: string): boolean {
  const key = searchKey(source);
  return searchKey(query)
    .split(' ')
    .filter(Boolean)
    .every((term) => key.includes(term));
}

/** Chỉ giữ chữ số. */
export const digitsOnly = (input: string): string => input.replace(/\D/g, '');

/** SĐT dạng nhóm cho dễ đọc: 0901 234 567. Không đổi dữ liệu gốc. */
export function formatPhone(phone: string): string {
  const d = digitsOnly(phone);
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : phone;
}

/** CCCD dạng nhóm: 0923 0100 4871. */
export function formatIdNumber(idNumber: string): string {
  const d = digitsOnly(idNumber);
  return d.length === 12 ? `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}` : idNumber;
}

export const isValidPhone = (v: string): boolean => digitsOnly(v).length === 10;
export const isValidIdNumber = (v: string): boolean => digitsOnly(v).length === 12;

/** Tên khi XUẤT Excel: VIẾT HOA, BỎ DẤU. Lúc nhập không ràng buộc gì. */
export const nameForExcel = (name: string): string =>
  removeDiacritics(name).toUpperCase();

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

/**
 * Điểm KPI cho người đọc: `1.2` ra `1,2`, `2` ra `2`, `8.400000000000001` ra `8,4`.
 *
 * Thang điểm từ kỳ 2026-08 là số lẻ (0,4 đến 1,2 mỗi khách) nên không được in
 * thẳng số thực: cộng nhị phân đẻ ra đuôi rác, và `toFixed(2)` thì mọi số tròn
 * đều mọc thêm `,00`.
 */
export function formatPoints(points: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(points);
}

/** Làm tròn 2 số lẻ — đúng bằng `numeric(10,2)` của `kpi_scores`. */
export const roundPoints = (points: number): number => Math.round(points * 100) / 100;

export function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Múi giờ nghiệp vụ. Máy chủ và container Postgres đều chạy UTC, nên mọi phép
 * "hôm nay là ngày mấy" phải nói rõ múi giờ, không được để môi trường tự quyết.
 */
export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Ngày làm việc `YYYY-MM-DD` theo giờ Việt Nam.
 *
 * KHÔNG dùng `toISOString().slice(0, 10)`: hàm đó trả ngày theo UTC, mà Việt Nam
 * là UTC+7 nên từ 0h đến 7h sáng nó vẫn đang ở ngày hôm trước. Lọc "Hôm nay"
 * bằng ngày đó là ra dữ liệu của hôm qua, và ngày mùng 1 thì ra cả tháng trước.
 */
export const businessDay = (at: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(at);

/** Tháng làm việc `YYYY-MM` theo giờ Việt Nam. */
export const businessMonth = (at: Date = new Date()): string => businessDay(at).slice(0, 7);

/**
 * Ngày đầu và ngày cuối của tháng `YYYY-MM`, dạng `YYYY-MM-DD`.
 *
 * `Date.UTC(y, m, 0)` là ngày 0 của tháng SAU, tức ngày cuối của tháng này —
 * tự đúng cả tháng 28, 29, 30, 31 mà không cần bảng tra.
 */
export const monthRange = (yearMonth: string): { from: string; to: string } => {
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(last).padStart(2, '0')}` };
};

/**
 * Mã danh mục sinh từ tên: bỏ dấu, viết hoa, nối gạch — "Phòng Kinh doanh 10"
 * thành `PHONG-KINH-DOANH-10`.
 *
 * Mã là thứ bản ghi khác trỏ vào và là thứ module luật theo kỳ đối chiếu, nên
 * nó phải ổn định khi tên đổi — sinh MỘT lần lúc lập, không tính lại.
 * `fallback` dùng khi tên toàn ký tự đặc biệt, không còn chữ nào để làm mã.
 */
export const codeFrom = (name: string, fallback: string): string =>
  removeDiacritics(name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || fallback;

/** `codeFrom` nhưng nối số khi đụng mã đã có. Không bao giờ ghi đè mã của bản ghi khác. */
export const uniqueCode = (name: string, fallback: string, taken: Set<string>): string => {
  const base = codeFrom(name, fallback);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
};


// Định dạng ngày và tiền theo cách trang PVI nhận. Dùng chung cho mọi flow.

const pad = (n) => String(n).padStart(2, '0');

/** `dd/mm/yyyy` — định dạng mọi ô ngày của PVI. */
const fmtNgay = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

/**
 * `YYYY-MM-DD` → `Date` giờ địa phương.
 *
 * KHÔNG dùng `new Date(chuoi)`: chuỗi dạng đó là nửa đêm UTC, đọc lại bằng giờ
 * máy là lệch mất một ngày.
 */
const doiISO = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Ngày phải dạng YYYY-MM-DD, nhận "${s}"`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const congNgay = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const congNam = (d) => new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
const congPhut = (d, n) => new Date(d.getTime() + n * 60 * 1000);

/**
 * `HH:mm` 24 giờ — định dạng của ô StartTime và EndTime.
 *
 * Thẻ HTML render sẵn `2:05 PM`, nhưng bootstrap-timepicker của trang chạy với
 * `showMeridian: false` và ghi đè thành 24 giờ ngay lúc khởi tạo. Đo trên trang
 * thật 2026-08-23.
 */
const fmtGio = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Code của trang tự ghi "40 000 000", nên dùng dấu cách phân tách nghìn. */
const fmtTien = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

module.exports = { fmtNgay, fmtGio, doiISO, congNgay, congNam, congPhut, fmtTien };

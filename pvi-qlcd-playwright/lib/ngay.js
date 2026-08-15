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

/** Code của trang tự ghi "40 000 000", nên dùng dấu cách phân tách nghìn. */
const fmtTien = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

module.exports = { fmtNgay, doiISO, congNgay, congNam, fmtTien };

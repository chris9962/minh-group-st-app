/**
 * Tiền tính bằng ĐỒNG × 100 (số nguyên), % bằng đơn vị 0,001% (9,120% = 9120).
 *
 * Phép nhân tiền × % đi qua BigInt, không qua số thực: 1.263.600 × 7,84% phải ra
 * đúng 99.066,24đ, còn số thực của JS cho 99066.23999… và làm tròn sai một đồng
 * lẻ. Tiền chi và tiền nhận phải khớp tuyệt đối với file (chốt 2026-10-04).
 */

/** 100% theo đơn vị 0,001%. */
export const RATE_SCALE = 100_000;

/** `cents × rate / RATE_SCALE`, làm tròn nửa lên ở đơn vị 0,01đ. */
export function applyRate(cents: number, rate: number): number {
  const product = BigInt(cents) * BigInt(rate);
  const scale = BigInt(RATE_SCALE);
  const whole = product / scale;
  return Number((product % scale) * BigInt(2) >= scale ? whole + BigInt(1) : whole);
}

/** Cột `numeric` của Postgres trả chuỗi `"99066.24"`. Đổi sang đồng × 100 không qua số thực. */
export function centsFromDecimal(value: string): number {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  return negative ? -cents : cents;
}

export function decimalFromCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** `99.066,24đ`; số tròn đồng thì bỏ phần lẻ: `9.120đ`. */
export function formatCents(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return `${new Intl.NumberFormat('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(cents / 100)}đ`;
}

/** `9120` ra `9,12%`, `7056` ra `7,056%`. */
export const formatRate = (rate: number): string =>
  `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(rate / 1000)}%`;

/** Tối đa của `numeric(14,2)`. */
const MAX_CENTS = 99_999_999_999_999;

/**
 * Số dạng chữ thành chuỗi `123.45` chuẩn, hoặc `null` khi không đọc được.
 *
 * Có cả `.` và `,` thì dấu đứng sau là dấu thập phân: `99.066,24` và
 * `99,066.24`. Chỉ có một loại dấu thì đó là dấu nghìn khi mọi nhóm sau nó đủ 3
 * chữ số (`1.263.600`), còn lại là dấu thập phân (`9,12`).
 */
function normalizeNumber(raw: string): string | null {
  const v = raw.replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(v)) return null;
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const thousands = at === lastDot ? ',' : '.';
    const whole = v.slice(0, at).split(thousands);
    const fraction = v.slice(at + 1);
    const grouped =
      /^[1-9]\d{0,2}$/.test(whole[0]) && whole.slice(1).every((g) => /^\d{3}$/.test(g));
    return grouped && /^\d+$/.test(fraction) ? `${whole.join('')}.${fraction}` : null;
  }
  const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (!sep) return v;
  const groups = v.split(sep);
  // Nhóm đầu là 0 thì không phải dấu nghìn: `0.995` là chưa tới 1 đồng.
  const isThousands =
    groups.length > 1 && /^[1-9]\d{0,2}$/.test(groups[0]) && groups.slice(1).every((g) => g.length === 3);
  if (isThousands) return groups.join('');
  return groups.length === 2 ? `${groups[0]}.${groups[1]}` : null;
}

/**
 * Tiền trong file thành đồng × 100. Hơn 2 số lẻ thì làm tròn nửa lên về 2 số
 * lẻ. Trống ra `null`, không đọc được ra `'invalid'`.
 */
export function parseMoneyCents(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim().toLowerCase().replace(/(vnđ|vnd|đ)$/, '').trim();
  if (trimmed === '') return null;
  const normalized = normalizeNumber(trimmed);
  if (!normalized) return 'invalid';
  const [whole, fraction = ''] = normalized.split('.');
  let cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1;
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : 'invalid';
}

/**
 * % trong file thành đơn vị 0,001%. Nhận `9,12%`, `9.12`, `9,120`. Số không có
 * dấu `%` mà nhỏ hơn 1 thì hiểu là phân số (`0,0912` = 9,12%), vì mọi mức trong
 * bảng hoa hồng đều lớn hơn 1%.
 */
export function parseRate(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const hasPercent = trimmed.endsWith('%');
  const body = trimmed.replace(/%$/, '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(body)) return 'invalid';
  const value = Number(body);
  const percent = !hasPercent && value < 1 ? value * 100 : value;
  return Math.round(percent * 1000);
}

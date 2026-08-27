import type { UseFormRegisterReturn } from 'react-hook-form';

/**
 * Ô nhập số dùng `type="text"` + `inputMode`, KHÔNG dùng `type="number"`:
 * Safari không chặn chữ trong ô number, còn bàn phím số trên mobile do
 * `inputMode` quyết định. Mỗi ô ghép một hàm LỌC ký tự (gắn qua `numericField`)
 * với `numberValue` ở `setValueAs` — thay cho `valueAsNumber`.
 */

/** Số nguyên không âm — chỉ giữ chữ số. */
export const digitsOnly = (v: string): string => v.replace(/[^0-9]/g, '');

/** Số thập phân không âm — chữ số và dấu phẩy/chấm. */
export const decimalOnly = (v: string): string => v.replace(/[^0-9.,]/g, '');

/** Số thập phân có dấu — dấu trừ chỉ có nghĩa ở đầu chuỗi. */
export const signedDecimalOnly = (v: string): string => {
  const cleaned = v.replace(/[^0-9.,-]/g, '');
  return (cleaned.startsWith('-') ? '-' : '') + cleaned.replace(/-/g, '');
};

/**
 * `setValueAs` cho ô số: dấu phẩy kiểu Việt Nam thành dấu chấm rồi parse.
 * Chuỗi rỗng thành NaN để zod báo đúng câu lỗi của ô — không lặng lẽ thành 0.
 */
export const numberValue = (v: unknown): number => {
  const s = String(v).trim().replace(',', '.');
  return s === '' || s === '-' ? Number.NaN : Number(s);
};

/** Gắn bộ lọc ký tự vào field đã `register` — spread kết quả vào `TextField`. */
export function numericField<T extends string>(
  field: UseFormRegisterReturn<T>,
  sanitize: (v: string) => string,
): UseFormRegisterReturn<T> {
  return {
    ...field,
    // Hình dạng tham số theo `ChangeHandler` của react-hook-form, không phải
    // `ChangeEvent` của React — RHF khai `{ target; type? }` rộng hơn.
    onChange: (e: { target: HTMLInputElement; type?: unknown }) => {
      e.target.value = sanitize(e.target.value);
      return field.onChange(e);
    },
  };
}

/** Tên người phải có chữ; vẫn nhận chữ có dấu và không dấu. */
export const personNameHasLetter = (name: string) => /\p{L}/u.test(name);

export const PERSON_NAME_LETTER_ERROR = 'Họ tên phải có chữ, không được chỉ nhập số hoặc ký hiệu';

/**
 * Mỗi chữ viết hoa chữ cái đầu, phần còn lại viết thường, gộp khoảng trắng
 * thừa (chốt 2026-09-16). Hạ cả tên gõ HOA HẾT: CCCD in hoa nên KD hay chép
 * nguyên. `toLocaleUpperCase('vi')` để `đ` → `Đ` đúng, không thành `D`.
 */
export const capitalizePersonName = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase('vi') + word.slice(1).toLocaleLowerCase('vi'))
    .join(' ');

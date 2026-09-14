/** Tên người phải có chữ; vẫn nhận chữ có dấu và không dấu. */
export const personNameHasLetter = (name: string) => /\p{L}/u.test(name);

export const PERSON_NAME_LETTER_ERROR = 'Họ tên phải có chữ, không được chỉ nhập số hoặc ký hiệu';

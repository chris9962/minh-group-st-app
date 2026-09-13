import type { PhotoCheckItem } from "@/lib/api/photoCheck";

/**
 * Mục kiểm kèm số thứ tự chuỗi chữ đã cung cấp dữ liệu.
 *
 * Bộ nhãn vốn đọc TỪNG ảnh riêng rồi chọn ảnh nhận ra rõ nhất, nhưng bước lọc
 * làm mất số thứ tự. Không giữ nó thì tầng gọi phải chạy lại cả bộ nhãn chỉ để
 * tìm lại ảnh nào, và phải đoán bằng bảng từ khóa khi chọn ảnh gửi sang lượt
 * OCR thứ hai. `undefined` = không chuỗi nào nhận ra màn này.
 */
export type CheckedItem = PhotoCheckItem & { photoIndex?: number };

/** Giữ số thứ tự chuỗi chữ lại trước khi parser lọc bỏ chuỗi không nhận ra. */
export const indexed = <T extends object>(
  texts: string[],
  parse: (text: string) => T,
): (T & { photoIndex: number })[] =>
  texts.map((text, photoIndex) => ({ ...parse(text), photoIndex }));

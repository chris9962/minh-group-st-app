import type { ReactNode } from "react";

export type FilterFieldProps = {
  id: string;
  /** Tên mục ở cột trái, ví dụ "Phòng". */
  label: string;
  /** Số điều kiện đang bật. 0 thì không hiện số. */
  count?: number;
  children: ReactNode;
};

/**
 * Một mục lọc trong `FilterButton`.
 *
 * Bản thân không vẽ gì — nút đọc `id`/`label`/`count` để dựng cột trái, rồi
 * đặt `children` sang cột phải khi mục được chọn. Khai báo kiểu này để mỗi
 * màn không phải tự ghép layout hai cột.
 */
export function FilterField(_props: FilterFieldProps) {
  return null;
}
FilterField.displayName = "FilterField";

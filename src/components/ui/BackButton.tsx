"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "./Button";
import styles from "./BackButton.module.scss";

type Props = {
  onClick: () => void;
  /** Nhãn hành động, ví dụ "Chọn khách khác". Cũng là `aria-label` của nút. */
  children: string;
};

/**
 * Nút đi NGƯỢC một bước trong hộp thoại nhiều bước. Đặt ở `footerStart` của
 * `Dialog` nên nó canh trái, tách khỏi nhóm nút xác nhận bên phải.
 *
 * Trên điện thoại chỉ còn mũi tên, nhưng `aria-label` vẫn mang trọn câu chữ —
 * nút chỉ có icon mà không có nhãn là người dùng trình đọc màn hình nghe thấy
 * "button" trống.
 */
export function BackButton({ onClick, children }: Props) {
  return (
    <Button variant="secondary" onClick={onClick} aria-label={children}>
      <ArrowLeft size={16} aria-hidden />
      <span className={styles.label}>{children}</span>
    </Button>
  );
}

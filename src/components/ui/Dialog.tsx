"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import styles from "./Dialog.module.css";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Hàng nút ở chân hộp thoại. */
  footer?: React.ReactNode;
};

/**
 * Hộp thoại.
 *
 * Dùng thẻ `<dialog>` gốc thay vì tự dựng: trình duyệt lo sẵn bẫy tiêu điểm,
 * phím Esc, lớp phủ và việc chặn phần nền với trình đọc màn hình. Tự dựng bằng
 * div thì phải viết lại từng thứ đó, và thiếu một cái là bàn phím kẹt.
 */
export function Dialog({ open, title, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  // Đồng bộ với DOM ngoài React: `open` là thuộc tính, còn showModal() mới bật
  // lớp phủ và bẫy tiêu điểm — đặt thuộc tính thôi thì không có hai thứ đó.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Bấm ra ngoài thì đóng. Sự kiện rơi vào chính thẻ dialog nghĩa là bấm
      // trúng lớp phủ, vì nội dung nằm trong thẻ con.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className={styles.panel}>
          <header className={styles.head}>
            <h2 className={styles.title}>{title}</h2>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Đóng"
            >
              <X size={18} aria-hidden />
            </button>
          </header>

          <div className={styles.body}>{children}</div>

          {footer && <footer className={styles.foot}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

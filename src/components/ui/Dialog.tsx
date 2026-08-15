"use client";

import { ChevronDown, X } from "lucide-react";
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { useDialogLayer } from "@/store/dialogLayer";
import styles from "./Dialog.module.css";

/**
 * DOM của `<dialog>` đang bao quanh, nếu có — nơi khác dùng để portal ra
 * (xem `Combobox`). `<dialog open>` đẩy nội dung của nó vào "top layer" của
 * trình duyệt, đứng trên mọi DOM thường bất kể z-index; một popup portal ra
 * thẳng `document.body` (mặc định của Radix) sẽ bị NẰM DƯỚI hộp thoại đang
 * mở. Portal vào chính bên trong `<dialog>` này thì vẫn ở trong top layer đó.
 */
export const DialogPortalContext = createContext<HTMLDialogElement | null>(null);

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
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Đồng bộ với DOM ngoài React: `open` là thuộc tính, còn showModal() mới bật
  // lớp phủ và bẫy tiêu điểm — đặt thuộc tính thôi thì không có hai thứ đó.
  //
  // Khai báo mình vào `dialogLayer`: toast phải nằm bên trong hộp thoại đang mở
  // mới nổi lên trên được (xem store đó). Gỡ khai báo trong cleanup để hộp
  // thoại bị tháo đột ngột không để lại phần tử chết trong ngăn xếp.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();

    if (!open) return;
    const { push, pop } = useDialogLayer.getState();
    push(el);
    return () => pop(el);
  }, [open]);

  /**
   * Đo theo ĐÁY KHỐI NỘI DUNG, không theo `scrollHeight`.
   *
   * `scrollHeight` cộng cả phần tràn của mọi lớp phủ tuyệt đối bên trong. Vùng
   * bấm 44px của nút chép nới `::after` ra 13px dưới đáy nút là một cái: hộp
   * thoại một dòng cũng đo ra thừa 9px, và mũi tên hiện lên chỉ xuống chỗ trống.
   * Bọc `children` trong một khối riêng rồi so đáy hai khối thì phần vô hình đó
   * không được tính.
   */
  const checkScroll = useCallback(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content) return;
    const remaining =
      content.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom;
    setCanScrollDown(remaining > 2);
  }, []);

  // Nội dung dài ngắn khác nhau tuỳ hộp thoại, có nơi đổi kích thước sau khi
  // mở (chọn gói bảo hiểm mới hiện thêm form) — phải đo kích thước THẬT của
  // DOM mới biết còn cuộn được không, không suy ra được lúc render.
  useEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content) return;
    checkScroll();
    const observer = new ResizeObserver(checkScroll);
    observer.observe(body);
    observer.observe(content);
    return () => observer.disconnect();
  }, [checkScroll, open]);

  return (
    <dialog
      ref={(el) => {
        ref.current = el;
        setDialogEl(el);
      }}
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
        <DialogPortalContext.Provider value={dialogEl}>
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

            <div className={styles.bodyWrap}>
              <div ref={bodyRef} className={styles.body} onScroll={checkScroll}>
                <div ref={contentRef}>{children}</div>
              </div>
              {canScrollDown && (
                <div className={styles.scrollHint} aria-hidden="true">
                  <ChevronDown size={16} />
                </div>
              )}
            </div>

            {footer && <footer className={styles.foot}>{footer}</footer>}
          </div>
        </DialogPortalContext.Provider>
      )}
    </dialog>
  );
}

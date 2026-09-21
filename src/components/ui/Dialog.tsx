"use client";

import { ChevronDown, X } from "lucide-react";
import { clsx } from "clsx";
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
  /** Hàng nút ở chân hộp thoại, canh PHẢI. */
  footer?: React.ReactNode;
  /**
   * Nút canh TRÁI ở chân hộp thoại — dành cho hành động đi NGƯỢC luồng, ví dụ
   * "Chọn khách khác" quay về bước 1. Tách khỏi nhóm bên phải để nó không nằm
   * lẫn với nút xác nhận và bị bấm nhầm.
   */
  footerStart?: React.ReactNode;
  /** Hộp rộng cho nội dung dạng lưới; mặc định giữ 560px cho biểu mẫu. */
  wide?: boolean;
  /**
   * `sheet` = trượt lên từ đáy màn hình (chọn việc trên điện thoại).
   * Mặc định hộp thoại giữa màn.
   */
  placement?: "center" | "sheet";
  /**
   * `false` = KHÔNG có nút X, Esc và bấm ra ngoài đều không đóng. Chỉ nút trong
   * `footer` mới đóng được. Dành cho hộp thoại người dùng PHẢI xác nhận, ví dụ
   * bản cập nhật (`ReleaseGate`). Mặc định `true`.
   */
  dismissible?: boolean;
};

/**
 * Hộp thoại.
 *
 * Dùng thẻ `<dialog>` gốc thay vì tự dựng: trình duyệt lo sẵn bẫy tiêu điểm,
 * phím Esc, lớp phủ và việc chặn phần nền với trình đọc màn hình. Tự dựng bằng
 * div thì phải viết lại từng thứ đó, và thiếu một cái là bàn phím kẹt.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  footerStart,
  wide = false,
  placement = "center",
  dismissible = true,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isSheet = placement === "sheet";
  const [entered, setEntered] = useState(false);
  const [shown, setShown] = useState(open);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Đồng bộ với DOM ngoài React: `open` là thuộc tính, còn showModal() mới bật
  // lớp phủ và bẫy tiêu điểm — đặt thuộc tính thôi thì không có hai thứ đó.
  //
  // Sheet phải đợi `showModal()` xong rồi mới gỡ `translateY(100%)`: gắn
  // animation lúc còn `display: none` thì trình duyệt coi như đã chạy xong,
  // hộp thoại hiện sẵn ở đáy chứ không đẩy lên.
  //
  // Khai báo mình vào `dialogLayer`: toast phải nằm bên trong hộp thoại đang mở
  // mới nổi lên trên được (xem store đó). Gỡ khai báo trong cleanup để hộp
  // thoại bị tháo đột ngột không để lại phần tử chết trong ngăn xếp.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (open) {
      setShown(true);
      if (!el.open) el.showModal();
      /**
       * Kéo tiêu điểm khỏi nút Đóng.
       *
       * `showModal()` tự đặt tiêu điểm vào phần tử bấm được ĐẦU TIÊN trong hộp
       * thoại, và đó luôn là nút Đóng ở góc phải tiêu đề. Trình duyệt coi lượt
       * đặt tiêu điểm đó là "đi bằng bàn phím" nên `:focus-visible` bật, và mọi
       * hộp thoại mở ra đều có một khung viền quanh dấu X.
       *
       * Đặt vào khung hộp thoại thay vì bỏ hẳn: bẫy tiêu điểm và phím Esc của
       * `<dialog>` cần tiêu điểm nằm BÊN TRONG. Bỏ hẳn thì Tab đầu tiên nhảy ra
       * thanh địa chỉ trình duyệt.
       *
       * KHÔNG đặt vào ô nhập đầu tiên: đội kinh doanh dùng điện thoại, và bàn
       * phím ảo bật ngay lúc mở sẽ che mất nửa hộp thoại.
       */
      panelRef.current?.focus();
      const { push, pop } = useDialogLayer.getState();
      push(el);
      let cancelled = false;
      if (!isSheet || reduceMotion) {
        setEntered(true);
      } else {
        setEntered(false);
        /**
         * `showModal()` mới bỏ `display: none`. Phải để khung vẽ xong ở
         * `translateY(100%)` rồi mới gắn `sheetIn` — đổi transform cùng lúc
         * hiện dialog thì không có transition, hộp đã nằm sẵn ở đáy.
         */
        requestAnimationFrame(() => {
          panelRef.current?.getBoundingClientRect();
          requestAnimationFrame(() => {
            if (!cancelled) setEntered(true);
          });
        });
      }
      return () => {
        cancelled = true;
        pop(el);
      };
    }

    setEntered(false);
    if (!el.open) {
      setShown(false);
      return;
    }
    if (!isSheet || reduceMotion) {
      el.close();
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => {
      el.close();
      setShown(false);
    }, 400);
    return () => clearTimeout(t);
  }, [open, isSheet]);

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
      className={clsx(
        styles.dialog,
        placement === "sheet" && styles.dialogSheet,
        placement === "sheet" && entered && styles.dialogEntered,
      )}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        // Hộp thoại lồng nhau: React cho `onCancel` nổi lên hộp cha theo cây
        // component, kể cả qua portal. Không chặn thì Esc trong hộp con đóng
        // luôn hộp cha và mất biểu mẫu đang điền.
        e.stopPropagation();
        if (dismissible) onClose();
      }}
      // Bấm ra ngoài thì đóng. Sự kiện rơi vào chính thẻ dialog nghĩa là bấm
      // trúng lớp phủ, vì nội dung nằm trong thẻ con.
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      {(isSheet ? open || shown : open) && (
        <DialogPortalContext.Provider value={dialogEl}>
          {/* `tabIndex={-1}` để `focus()` gọi được, nhưng Tab không dừng ở đây. */}
          <div
            ref={panelRef}
            className={clsx(
              styles.panel,
              wide && styles.wide,
              placement === "sheet" && styles.sheet,
              placement === "sheet" && entered && styles.sheetIn,
            )}
            tabIndex={-1}
          >
            {placement === "sheet" && <div className={styles.handle} aria-hidden />}
            <header className={styles.head}>
              <h2 className={styles.title}>{title}</h2>
              {dismissible && (
                <button
                  type="button"
                  className={styles.close}
                  onClick={onClose}
                  aria-label="Đóng"
                >
                  <X size={18} aria-hidden />
                </button>
              )}
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

            {(footer || footerStart) && (
              <footer className={styles.foot}>
                {footerStart && <div className={styles.footStart}>{footerStart}</div>}
                {footer}
              </footer>
            )}
          </div>
        </DialogPortalContext.Provider>
      )}
    </dialog>
  );
}

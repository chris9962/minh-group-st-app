"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { topDialog, useDialogLayer } from "@/store/dialogLayer";
import { useToasts, type ToastTone } from "@/lib/toast";
import styles from "./Toast.module.scss";

/** 5 giây cho MỌI toast, kể cả báo lỗi (quyết định của chủ dự án). */
const TOAST_MS = 5000;

/**
 * Màu không được là kênh truyền đạt duy nhất (AGENTS.md §8) — mỗi tone kèm một
 * ký hiệu, cùng quy ước với `Alert`.
 */
const MARK: Record<ToastTone, string> = { ok: "✓", fail: "❌" };

/**
 * Đã chạy ở trình duyệt chưa — `createPortal` cần một nút DOM thật, mà lượt
 * render đầu tiên diễn ra ở máy chủ. `useSyncExternalStore` với hai ảnh chụp
 * khác nhau là cách React chính thức hỏi câu này; đặt state trong effect cũng
 * ra kết quả đúng nhưng tốn thêm một lượt render lồng nhau.
 */
const NEVER_CHANGES = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );

/**
 * Nơi mọi toast hiện ra. Mount MỘT lần ở `providers.tsx`.
 *
 * Mount ở gốc chứ không phải trong `AppShell`: màn đăng nhập nằm ngoài
 * `AppShell`, đặt trong đó thì đăng nhập hỏng không có gì báo.
 *
 * Radix lo phần khó: hẹn giờ tự tắt, dừng đếm khi rê chuột hoặc focus, vùng
 * `aria-live` đúng chuẩn, nuốt sang phải để tắt trên cảm ứng, phím F8 nhảy tới
 * danh sách toast. Đừng thay bằng đồ tự viết.
 */
export function ToastHost() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const stack = useDialogLayer((s) => s.stack);

  // `document` không tồn tại lúc render phía máy chủ.
  const hydrated = useHydrated();
  if (!hydrated) return null;

  /**
   * Portal vào `<dialog>` đang mở nếu có.
   *
   * `showModal()` đẩy hộp thoại vào top layer của trình duyệt, đứng trên mọi
   * DOM thường BẤT KỂ z-index — toast render ở gốc app sẽ nằm dưới nó và người
   * dùng không thấy gì. Vào trong chính hộp thoại thì cùng top layer, nổi lên
   * đúng chỗ. Xem `store/dialogLayer.ts`.
   */
  const host = topDialog(stack) ?? document.body;

  return createPortal(
    <RadixToast.Provider swipeDirection="right" duration={TOAST_MS}>
      {items.map((t) => (
        <RadixToast.Root
          key={t.id}
          className={`${styles.toast} ${styles[t.tone]}`}
          open
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <span className={styles.mark} aria-hidden>
            {MARK[t.tone]}
          </span>
          <RadixToast.Description className={styles.text}>{t.message}</RadixToast.Description>
          <RadixToast.Close className={styles.close} aria-label="Đóng thông báo">
            <X size={16} aria-hidden />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className={styles.viewport} />
    </RadixToast.Provider>,
    host,
  );
}

"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
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
const MARK: Record<ToastTone, string> = { ok: "✓", warn: "⚠", fail: "❌" };

/**
 * Đã chạy ở trình duyệt chưa. Máy chủ không có `document` nên không dựng được
 * container, tức lượt render đầu ở máy chủ ra rỗng — client phải ra rỗng y hệt
 * ở lượt hydrate, không thì React báo lệch cây. Hai ảnh chụp khác nhau của
 * `useSyncExternalStore` là cách React chính thức hỏi câu này.
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
 *
 * ══ Vì sao lằng nhằng thế này ══
 *
 * Toast phải nổi trên hộp thoại, mà `<dialog showModal()>` nằm ở TOP LAYER của
 * trình duyệt — một tầng vẽ ngoài cây xếp chồng thường, không `z-index` nào
 * với tới. Đã đo bằng trình duyệt thật, hai cách đầu đều hỏng:
 *
 *  1. `popover="manual"` — cũng vào top layer, nhưng modal `<dialog>` LUÔN vẽ
 *     trên popover, bất kể mở cái nào trước; đóng rồi mở lại popover cũng
 *     không đảo được thứ tự.
 *  2. Đổi container của `createPortal` theo hộp thoại đang mở — nổi lên đúng,
 *     nhưng đổi container thì React tháo cả cây con rồi dựng lại: toast chớp
 *     một cái mỗi lần mở/đóng hộp thoại, và `ToastImpl` mount lại là bộ đếm
 *     5 giây chạy lại từ đầu.
 *
 * Cách chạy được: giữ container CỐ ĐỊNH cho React, rồi tự tay chuyển chính nút
 * DOM đó vào trong `<dialog>` bằng `appendChild`. Nút không đổi nên React
 * không dựng lại gì — bộ đếm và trạng thái đều còn nguyên — mà nội dung thì đã
 * nằm trong hộp thoại nên vẽ đè lên. Cùng lối `Combobox` dùng cho ô chọn.
 */
export function ToastHost() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const stack = useDialogLayer((s) => s.stack);
  const hydrated = useHydrated();

  // Tạo một lần, không bao giờ đổi — đây là điểm mấu chốt để React khỏi dựng
  // lại. `null` ở lượt render phía máy chủ, nơi chưa có `document`.
  const [container] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );

  useEffect(() => {
    if (!container) return;
    const parent = topDialog(stack) ?? document.body;
    if (container.parentNode === parent) return;

    parent.appendChild(container);

    /**
     * Gỡ node ra rồi cắm lại làm CSS chạy LẠI mọi hoạt ảnh từ đầu: toast đang
     * đứng yên bỗng trượt vào thêm lần nữa mỗi khi mở hoặc đóng hộp thoại,
     * nhìn hệt như bị dựng lại. React không dựng lại gì — đã đo — nhưng người
     * dùng không phân biệt được. Nhảy thẳng tới cuối hoạt ảnh.
     */
    for (const el of container.querySelectorAll("*")) {
      for (const animation of el.getAnimations()) animation.finish();
    }
  }, [container, stack]);

  // Dọn khi `Providers` bị tháo — chỉ xảy ra lúc hot-reload, nhưng không dọn
  // thì mỗi lần nạp lại để thừa một div rỗng trong body.
  useEffect(() => () => container?.remove(), [container]);

  if (!hydrated || !container) return null;

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
    container,
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { downloadImage } from "@/lib/downloadImage";
import { useDialogLayer } from "@/store/dialogLayer";
import styles from "./ImageLightbox.module.css";

export type LightboxPhoto = {
  src: string;
  alt: string;
  /** Dòng nội dung ngay dưới ảnh — chỗ đặt link hoặc chú thích của nơi gọi. */
  caption?: React.ReactNode;
};

type Props = { onClose: () => void } & (
  | LightboxPhoto
  | { photos: readonly LightboxPhoto[]; startIndex?: number }
);

type ListProps = { photos: readonly LightboxPhoto[]; startIndex?: number };

const isList = (props: Props): props is ListProps & { onClose: () => void } => "photos" in props;

/** Kéo ngang quá bấy nhiêu pixel thì tính là lướt sang tấm khác. */
const SWIPE_PX = 56;

const clamp = (value: number, last: number) => Math.min(Math.max(value, 0), Math.max(last, 0));

/**
 * Xem ảnh cỡ lớn ngay tại chỗ, lướt được sang tấm kế bên.
 *
 * Nhận MỘT ảnh (`src` + `alt`) hoặc CẢ DANH SÁCH (`photos` + `startIndex`).
 * Nơi gọi nào có nhiều ảnh thì truyền trọn danh sách: đội KD đối chiếu vài chục
 * tấm một lượt, mở ra đóng vào từng tấm là mỗi tấm một lượt bấm thừa.
 *
 * KHÔNG dùng lại `Dialog`: panel của nó khoá bề ngang 560px cho biểu mẫu, còn
 * ảnh cần cả khung nhìn. Vẫn là `<dialog>` gốc để trình duyệt lo lớp phủ, bẫy
 * tiêu điểm và phím Esc.
 */
export function ImageLightbox(props: Props) {
  const { onClose } = props;
  const photos = isList(props) ? props.photos : [props];
  const last = photos.length - 1;

  const ref = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(() => (isList(props) ? clamp(props.startIndex ?? 0, last) : 0));
  /** Toạ độ X lúc đặt ngón tay xuống; `null` = không kéo. */
  const dragFrom = useRef<number | null>(null);
  const [dragX, setDragX] = useState(0);

  // Danh sách co lại lúc đang mở (nơi gọi xoá một ảnh) thì kẹp lại, không để
  // `current` thành `undefined`.
  const at = clamp(index, last);
  const current = photos[at];

  const prevSrc = photos[at - 1]?.src;
  const nextSrc = photos[at + 1]?.src;

  // Nạp sẵn hai tấm kề bên vào bộ đệm trình duyệt — lướt tới là hiện ngay chứ
  // không chờ mạng. Bộ đệm là hệ thống ngoài React nên đúng chỗ cho effect.
  useEffect(() => {
    for (const src of [prevSrc, nextSrc]) {
      if (!src) continue;
      const img = new window.Image();
      img.src = src;
    }
  }, [prevSrc, nextSrc]);

  // Bắt phím mũi tên ở tầng tài liệu chứ không phải trên thẻ `dialog`: bấm nút
  // lướt tới tấm đầu hoặc tấm cuối là nút đó mờ đi, tiêu điểm rơi về `body` nên
  // phím gõ sau đó không còn nổi bọt qua thẻ `dialog` nữa.
  useEffect(() => {
    if (photos.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Chặn mặc định để phím mũi tên không cuộn trang nền phía sau lớp phủ.
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setIndex((i) => clamp(clamp(i, photos.length - 1) + step, photos.length - 1));
      setDragX(0);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [photos.length]);

  // Cùng lý do với `Dialog`: showModal() mới bật lớp phủ + bẫy tiêu điểm, và
  // phải khai vào `dialogLayer` để toast nổi đúng tầng khi mở từ trong hộp thoại.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const { push, pop } = useDialogLayer.getState();
    push(el);
    return () => pop(el);
  }, []);

  if (!current) return null;

  const many = photos.length > 1;

  const go = (step: number) => {
    setIndex(clamp(at + step, last));
    setDragX(0);
  };

  const download = async () => {
    setSaving(true);
    await downloadImage(current.src, current.alt);
    setSaving(false);
  };

  const startDrag = (e: React.PointerEvent<HTMLImageElement>) => {
    // `isPrimary` loại ngón thứ hai của cử chỉ phóng to: hai ngón là zoom, không
    // phải lướt.
    if (!many || !e.isPrimary) return;
    dragFrom.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (dragFrom.current === null) return;
    const dx = e.clientX - dragFrom.current;
    // Đầu và cuối danh sách thì kéo nặng tay: ảnh vẫn nhúc nhích để người dùng
    // biết cử chỉ có tác dụng, nhưng thấy ngay là hết ảnh.
    const blocked = (dx > 0 && at === 0) || (dx < 0 && at === last);
    setDragX(blocked ? dx / 4 : dx);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragFrom.current === null) return;
    const dx = e.clientX - dragFrom.current;
    dragFrom.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
    else setDragX(0);
  };

  const cancelDrag = () => {
    dragFrom.current = null;
    setDragX(0);
  };

  return (
    <dialog
      ref={ref}
      className={clsx(styles.lightbox, photos.some((p) => p.caption) && styles.withCaption)}
      aria-label={current.alt}
      onCancel={(e) => {
        // Chỉ nút X mới đóng trình xem. Giữ nguyên ảnh khi người dùng lỡ bấm
        // Esc trong lúc đang đối chiếu hoặc lướt qua nhiều ảnh.
        e.preventDefault();
      }}
    >
      {many && (
        <span className={styles.counter} aria-live="polite">
          {at + 1} / {photos.length}
        </span>
      )}
      <button
        type="button"
        className={styles.download}
        onClick={download}
        disabled={saving}
        aria-label="Tải ảnh về máy"
        title="Tải ảnh về máy"
      >
        <Download size={18} aria-hidden />
      </button>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">
        <X size={18} aria-hidden />
      </button>

      {many && (
        <button
          type="button"
          className={`${styles.nav} ${styles.prev}`}
          onClick={() => go(-1)}
          disabled={at === 0}
          aria-label="Ảnh trước"
        >
          <ChevronLeft size={20} aria-hidden />
        </button>
      )}

      <img
        src={current.src}
        alt={current.alt}
        className={clsx(styles.image, dragX !== 0 && styles.dragging)}
        style={dragX === 0 ? undefined : { transform: `translateX(${dragX}px)` }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
      />

      {many && (
        <button
          type="button"
          className={`${styles.nav} ${styles.next}`}
          onClick={() => go(1)}
          disabled={at === last}
          aria-label="Ảnh sau"
        >
          <ChevronRight size={20} aria-hidden />
        </button>
      )}

      {current.caption && <div className={styles.caption}>{current.caption}</div>}
    </dialog>
  );
}

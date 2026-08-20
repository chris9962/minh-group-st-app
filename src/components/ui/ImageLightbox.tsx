"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { downloadImage } from "@/lib/downloadImage";
import { useDialogLayer } from "@/store/dialogLayer";
import styles from "./ImageLightbox.module.css";

type Props = {
  src: string;
  alt: string;
  onClose: () => void;
};

/**
 * Xem một tấm ảnh cỡ lớn ngay tại chỗ.
 *
 * KHÔNG dùng lại `Dialog`: panel của nó khoá bề ngang 560px cho biểu mẫu, còn
 * ảnh cần cả khung nhìn. Vẫn là `<dialog>` gốc để trình duyệt lo lớp phủ, bẫy
 * tiêu điểm và phím Esc.
 */
export function ImageLightbox({ src, alt, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);

  const download = async () => {
    setSaving(true);
    await downloadImage(src, alt);
    setSaving(false);
  };

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

  return (
    <dialog
      ref={ref}
      className={styles.lightbox}
      aria-label={alt}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Bấm ra ngoài thì đóng — sự kiện rơi vào chính thẻ dialog nghĩa là bấm
      // trúng lớp phủ, vì ảnh nằm trong thẻ con.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
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
      <img src={src} alt={alt} className={styles.image} />
    </dialog>
  );
}

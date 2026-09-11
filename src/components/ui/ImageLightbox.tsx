"use client";

import { useEffect, useRef, useState } from "react";
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

const clamp = (value: number, last: number) => Math.min(Math.max(value, 0), Math.max(last, 0));

/**
 * Xem ảnh cỡ lớn ngay tại chỗ, chuyển sang tấm kế bên bằng cách bấm mép.
 *
 * Nhận MỘT ảnh (`src` + `alt`) hoặc CẢ DANH SÁCH (`photos` + `startIndex`).
 * Nơi gọi nào có nhiều ảnh thì truyền trọn danh sách: đội KD đối chiếu vài chục
 * tấm một lượt, mở ra đóng vào từng tấm là mỗi tấm một lượt bấm thừa.
 *
 * Bố cục: dialog phủ TRỌN màn hình, thanh nút nằm trong luồng ở trên, ảnh
 * `object-fit: contain` chiếm phần còn lại. Không có gì `position: fixed` bên
 * trong dialog. Bản trước neo nút bằng `fixed` còn ảnh tự co bằng `max-width`,
 * và ảnh lớn trên điện thoại vượt khung là nút đóng với nút tải mất luôn (đo
 * 2026-09-11). Ảnh không vượt được `object-fit: contain`, thanh nút thì không
 * nằm chồng lên ảnh, nên hết chỗ để mất.
 *
 * Chuyển ảnh bằng BẤM chứ không phải lướt: hai vùng bấm trong suốt phủ mép trái
 * và mép phải. Bản trước cho kéo ngón tay, nhưng trên điện thoại nó giật và hay
 * nhầm với cử chỉ phóng to.
 *
 * KHÔNG dùng lại `Dialog`: panel của nó khoá bề ngang 560px cho biểu mẫu. Vẫn
 * là `<dialog>` gốc để trình duyệt lo lớp phủ, bẫy tiêu điểm và phím Esc.
 */
export function ImageLightbox(props: Props) {
  const { onClose } = props;
  const photos = isList(props) ? props.photos : [props];
  const last = photos.length - 1;

  const ref = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(() => (isList(props) ? clamp(props.startIndex ?? 0, last) : 0));

  // Danh sách co lại lúc đang mở (nơi gọi xoá một ảnh) thì kẹp lại, không để
  // `current` thành `undefined`.
  const at = clamp(index, last);
  const current = photos[at];

  const prevSrc = photos[at - 1]?.src;
  const nextSrc = photos[at + 1]?.src;

  // Nạp sẵn hai tấm kề bên vào bộ đệm trình duyệt — bấm tới là hiện ngay chứ
  // không chờ mạng. Bộ đệm là hệ thống ngoài React nên đúng chỗ cho effect.
  useEffect(() => {
    for (const src of [prevSrc, nextSrc]) {
      if (!src) continue;
      const img = new window.Image();
      img.src = src;
    }
  }, [prevSrc, nextSrc]);

  // Bắt phím mũi tên ở tầng tài liệu chứ không phải trên thẻ `dialog`: bấm nút
  // tới tấm đầu hoặc tấm cuối là nút đó mờ đi, tiêu điểm rơi về `body` nên phím
  // gõ sau đó không còn nổi bọt qua thẻ `dialog` nữa.
  useEffect(() => {
    if (photos.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Chặn mặc định để phím mũi tên không cuộn trang nền phía sau lớp phủ.
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setIndex((i) => clamp(clamp(i, photos.length - 1) + step, photos.length - 1));
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
  const go = (step: number) => setIndex(clamp(at + step, last));

  const download = async () => {
    setSaving(true);
    await downloadImage(current.src, current.alt);
    setSaving(false);
  };

  return (
    <dialog
      ref={ref}
      className={styles.lightbox}
      aria-label={current.alt}
      onCancel={(e) => {
        // Chỉ nút X mới đóng trình xem. Giữ nguyên ảnh khi người dùng lỡ bấm
        // Esc trong lúc đang đối chiếu hoặc lướt qua nhiều ảnh.
        e.preventDefault();
      }}
      /*
       * Chrome bỏ qua preventDefault ở lần Esc THỨ HAI liên tiếp và tự đóng
       * dialog. Không nghe `close` thì state `open` của nơi gọi vẫn là true, bấm
       * ảnh lại là đặt true lên true, và showModal() không chạy lần nữa vì nó
       * chỉ chạy lúc mount. Đo 2026-09-11: đóng bằng hai lần Esc xong không mở
       * lại được.
       */
      onClose={onClose}
    >
      <div className={styles.bar}>
        {many ? (
          <span className={styles.counter} aria-live="polite">
            {at + 1} / {photos.length}
          </span>
        ) : (
          <span />
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.tool}
            onClick={download}
            disabled={saving}
            aria-label="Tải ảnh về máy"
            title="Tải ảnh về máy"
          >
            <Download size={18} aria-hidden />
          </button>
          <button type="button" className={styles.tool} onClick={onClose} aria-label="Đóng">
            <X size={18} aria-hidden />
          </button>
        </div>
      </div>

      <div className={styles.stage}>
        <img src={current.src} alt={current.alt} className={styles.image} />

        {/* Hai vùng bấm trong suốt phủ mép trái và mép phải của ảnh, mỗi bên
            10% nhưng không dưới 44px. Phần giữa để nguyên cho phóng to. */}
        {many && (
          <>
            <button
              type="button"
              className={`${styles.zone} ${styles.zonePrev}`}
              onClick={() => go(-1)}
              disabled={at === 0}
              aria-label="Ảnh trước"
            >
              <ChevronLeft size={22} aria-hidden />
            </button>
            <button
              type="button"
              className={`${styles.zone} ${styles.zoneNext}`}
              onClick={() => go(1)}
              disabled={at === last}
              aria-label="Ảnh sau"
            >
              <ChevronRight size={22} aria-hidden />
            </button>
          </>
        )}
      </div>

      {current.caption && <div className={styles.caption}>{current.caption}</div>}
    </dialog>
  );
}

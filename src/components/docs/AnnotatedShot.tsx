"use client";

import { useState } from "react";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import type { DocShot } from "@/lib/docs";
import styles from "./AnnotatedShot.module.scss";

type Props = {
  shot: DocShot;
};

/**
 * Ảnh chụp màn hình kèm vòng tròn đánh số, chú giải nằm bên dưới.
 *
 * Vòng tròn vẽ đè bằng CSS theo toạ độ %, không vẽ chết vào file ảnh: chụp lại
 * màn sau này chỉ thay file và chỉnh toạ độ, không cần mở trình sửa ảnh. Toạ độ
 * do `scripts/docs-shots.ts` đo tự động từ vị trí phần tử thật.
 *
 * Số trên ảnh `aria-hidden`: nghĩa của từng số đã nằm trọn ở danh sách chú
 * giải — trình đọc màn hình đọc danh sách đó, không mò toạ độ trên ảnh.
 */
export function AnnotatedShot({ shot }: Props) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <figure className={styles.figure}>
      <button
        type="button"
        className={styles.frame}
        onClick={() => setZoomed(true)}
        aria-label={`Phóng to ảnh: ${shot.alt}`}
      >
        <img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} />
        {shot.markers.map((m) => (
          <span
            key={m.n}
            className={styles.badge}
            style={{ left: `${m.x}%`, top: `${m.y}%` }}
            aria-hidden="true"
          >
            {m.n}
          </span>
        ))}
      </button>

      <figcaption>
        <ol className={styles.legend}>
          {shot.markers.map((m) => (
            <li key={m.n}>
              <span className={styles.legendBadge} aria-hidden="true">
                {m.n}
              </span>
              <span>{m.label}</span>
            </li>
          ))}
        </ol>
      </figcaption>

      {zoomed && (
        <ImageLightbox src={shot.src} alt={shot.alt} onClose={() => setZoomed(false)} />
      )}
    </figure>
  );
}

"use client";

import { useRef, useState } from "react";
import { ImagePlus, Pencil } from "lucide-react";
import styles from "./BankAccountPhotos.module.scss";

type Props = {
  photoUrls: string[];
  requiredPhotos: number;
  onChange: (photoUrls: string[]) => void;
};

/**
 * Ảnh chứng minh ở P-22 — dùng chung dù tài khoản đang `creating` hay `done`
 * (spec §4.7): số lượng bắt buộc theo cấu hình ngân hàng, nội dung không duyệt.
 */
export function BankAccountPhotos({ photoUrls, requiredPhotos, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);

  const openPicker = (slot: number) => {
    setPendingSlot(slot);
    fileInputRef.current?.click();
  };

  return (
    <div className={styles.photoSection}>
      <h3 className={styles.photoTitle}>
        Ảnh chứng minh ({photoUrls.length}/{requiredPhotos})
      </h3>

      <div className={styles.photoGrid}>
        {photoUrls.map((url, i) => (
          <div key={i} className={styles.photoTile}>
            <a href={url} target="_blank" rel="noreferrer">
              <img src={url} alt={`Ảnh chứng minh ${i + 1}`} className={styles.photo} />
            </a>
            <button
              type="button"
              className={styles.photoEdit}
              aria-label={`Thay ảnh chứng minh ${i + 1}`}
              onClick={() => openPicker(i)}
            >
              <Pencil size={14} aria-hidden />
            </button>
          </div>
        ))}

        {photoUrls.length < requiredPhotos && (
          <button type="button" className={styles.photoAdd} onClick={() => openPicker(photoUrls.length)}>
            <ImagePlus size={20} aria-hidden />
            Thêm ảnh
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className={styles.hiddenInput}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file || pendingSlot === null) return;
          const next = [...photoUrls];
          next[pendingSlot] = URL.createObjectURL(file);
          onChange(next);
          e.target.value = "";
          setPendingSlot(null);
        }}
      />
    </div>
  );
}

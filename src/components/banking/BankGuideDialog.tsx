"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import styles from "./BankGuideDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Mã ngân hàng — lên tiêu đề, để người đọc biết đang xem quy trình của ai. */
  bankCode: string;
  /** Chữ tự do nhiều dòng. `''` = ngân hàng chưa có hướng dẫn. */
  guide: string;
  /** Ảnh mẫu, ĐÚNG thứ tự người nhập xếp — khớp "Ảnh 1 · Ảnh 2…" trong `guide`. */
  photoUrls: string[];
};

/**
 * Xem hướng dẫn mở tài khoản của một ngân hàng.
 *
 * Chỉ ĐỌC. Sửa thì vào hộp thoại ngân hàng ở màn Ngân hàng & mã giới thiệu.
 *
 * Dùng chung cho bước 2 của màn mở tài khoản và bảng ngân hàng: cùng một nội
 * dung, và hai bản riêng thì sớm muộn một bản quên cập nhật.
 */
export function BankGuideDialog({ open, onClose, bankCode, guide, photoUrls }: Props) {
  /** Ảnh đang xem cỡ lớn; `null` = không mở. */
  const [zoomed, setZoomed] = useState<number | null>(null);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={`Hướng dẫn mở tài khoản ${bankCode}`}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        }
      >
        {guide ? (
          /*
            `white-space: pre-wrap` giữ nguyên xuống dòng người nhập gõ.

            Không dựng markdown: nội dung là các bước đánh số tay, mà một bộ
            markdown kéo theo cả bảng, liên kết và mã nhúng — thứ không ai cần ở
            đây và là chỗ dán vào được thẻ lạ.
          */
          <p className={styles.guide}>{guide}</p>
        ) : (
          <p className={styles.empty}>
            Ngân hàng này chưa có hướng dẫn. Người quản ngân hàng thêm được ở màn
            Ngân hàng &amp; mã giới thiệu.
          </p>
        )}

        {photoUrls.length > 0 && (
          <div className={styles.photos}>
            {photoUrls.map((url, i) => (
              <button
                key={url}
                type="button"
                className={styles.photoZoom}
                aria-label={`Xem ảnh mẫu ${i + 1} cỡ lớn`}
                onClick={() => setZoomed(i)}
              >
                {/* Số thứ tự hiện ngay trên ảnh: đoạn hướng dẫn gọi tên chúng là
                    "Ảnh 1", "Ảnh 2" — không đánh số thì người đọc phải tự đếm. */}
                <span className={styles.photoIndex}>{i + 1}</span>
                <img src={url} alt={`Ảnh mẫu ${i + 1}`} className={styles.photo} />
              </button>
            ))}
          </div>
        )}
      </Dialog>

      {zoomed !== null && (
        <ImageLightbox
          src={photoUrls[zoomed]}
          alt={`Ảnh mẫu ${zoomed + 1} của ${bankCode}`}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}

"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Pencil } from "lucide-react";
import { imageProblem, uploadImage } from "@/lib/api/uploads";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./BankAccountPhotos.module.scss";

type Props = {
  photoUrls: string[];
  requiredPhotos: number;
  onChange: (photoUrls: string[]) => void;
};

/**
 * Ảnh chứng minh ở P-22 — dùng chung dù tài khoản đang `creating` hay `done`
 * (spec §4.7): số lượng bắt buộc theo cấu hình ngân hàng, nội dung không duyệt.
 *
 * ⚠️ ẢNH PHẢI ĐI QUA MÁY CHỦ TRƯỚC KHI BÁO LÀ ĐÃ CÓ.
 *
 * Bản trước gọi `URL.createObjectURL(file)` rồi gửi thẳng chuỗi `blob:…` lên
 * lưu. Nó CHẠY được — ảnh hiện ra, bộ đếm nhảy đủ, nút "Hoàn thành" mở khoá —
 * nên lỗi không lộ ra lúc thử. Nhưng `blob:` chỉ sống trong đúng tab đang mở:
 * tải lại trang là ảnh vỡ vĩnh viễn, mà tài khoản thì đã tiêu một lượt mã và đã
 * vào điểm KPI. Bản ghi trông như đủ chứng minh trong khi không còn tấm nào.
 *
 * Nên thứ tự bắt buộc là: tải lên xong, CÓ URL thật, rồi mới gọi `onChange`.
 */
export function BankAccountPhotos({ photoUrls, requiredPhotos, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  const openPicker = (slot: number) => {
    if (uploading) return;
    setPendingSlot(slot);
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File, slot: number) => {
    // Chặn sớm ở trình duyệt để người dùng biết ngay, KHÔNG phải để tin tưởng —
    // máy chủ kiểm lại từ đầu bằng chữ ký đầu file.
    const problem = imageProblem(file);
    if (problem) {
      toast.fail(problem);
      return;
    }

    setUploading(true);
    try {
      const url = await uploadImage(file);
      const next = [...photoUrls];
      next[slot] = url;
      onChange(next);
    } catch (e) {
      toast.fail(errorMessage(e, `Không tải được ảnh "${file.name}".`));
    } finally {
      setUploading(false);
    }
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
              disabled={uploading}
              onClick={() => openPicker(i)}
            >
              <Pencil size={14} aria-hidden />
            </button>
          </div>
        ))}

        {photoUrls.length < requiredPhotos && (
          <button
            type="button"
            className={styles.photoAdd}
            disabled={uploading}
            onClick={() => openPicker(photoUrls.length)}
          >
            {uploading ? (
              <>
                <Loader2 size={20} aria-hidden className={styles.spinner} />
                Đang tải…
              </>
            ) : (
              <>
                <ImagePlus size={20} aria-hidden />
                Thêm ảnh
              </>
            )}
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
          const slot = pendingSlot;
          // Dọn ô chọn NGAY, trước khi chờ tải lên: giữ nguyên thì chọn lại
          // đúng file đó lần nữa sẽ không bắn sự kiện `change`.
          e.target.value = "";
          setPendingSlot(null);
          if (file && slot !== null) void handleFile(file, slot);
        }}
      />
    </div>
  );
}

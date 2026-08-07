"use client";

import { useEffect, useRef } from "react";
import { ImagePlus, Pencil, X } from "lucide-react";
import { PHOTO_MAX } from "@/lib/api/bankAccounts";
import { imageProblem, uploadImage } from "@/lib/api/uploads";
import { toast } from "@/lib/toast";
import styles from "./BankAccountPhotos.module.scss";

/**
 * Một ô ảnh: đã nằm trên máy chủ, hoặc vừa chọn và còn nằm trong máy người dùng.
 *
 * Phân biệt hai loại là điều bắt buộc, không phải cho gọn: ảnh `pending` mới chỉ
 * là một `blob:` sống trong đúng tab đang mở — tải lại trang là mất. Chỉ ảnh
 * `saved` mới đếm được vào số ảnh bắt buộc.
 */
export type PhotoItem =
  | { kind: "saved"; url: string }
  | { kind: "pending"; file: File; preview: string };

export const savedPhotos = (urls: string[]): PhotoItem[] =>
  urls.map((url) => ({ kind: "saved", url }));

/**
 * Tải những ảnh còn ở máy người dùng lên rồi trả TRỌN danh sách URL, đúng thứ tự.
 *
 * Tải TUẦN TỰ chứ không `Promise.all`: đội KD làm việc ngoài trời bằng 4G, bắn
 * năm file cùng lúc thì cả năm cùng chậm và một cái timeout là không biết cái
 * nào. Tuần tự thì hỏng ở tấm nào biết ngay tấm đó, và những tấm trước đã lên
 * rồi không phải làm lại.
 *
 * Ném lỗi ra ngoài chứ không nuốt — nơi gọi đang trong lượt "Hoàn thành", nuốt
 * lỗi ở đây là bản ghi lên `done` với ít ảnh hơn mức bắt buộc.
 */
export async function uploadPendingPhotos(photos: PhotoItem[]): Promise<string[]> {
  const urls: string[] = [];
  for (const photo of photos) {
    urls.push(photo.kind === "saved" ? photo.url : await uploadImage(photo.file));
  }
  return urls;
}

/**
 * Danh sách ảnh có khác thứ đang nằm trên máy chủ không.
 *
 * Dùng để KHÔNG ghi lại một danh sách y hệt mỗi lần bấm Lưu: câu ghi ảnh xoá
 * sạch rồi chèn lại, nên ghi thừa là một lượt đi về mạng và một khoảnh khắc bản
 * ghi không có tấm ảnh nào.
 */
export const photosChanged = (photos: PhotoItem[], savedUrls: string[]): boolean =>
  photos.length !== savedUrls.length ||
  photos.some((photo, i) => photo.kind === "pending" || photo.url !== savedUrls[i]);

type Props = {
  photos: PhotoItem[];
  /** Số ảnh BẮT BUỘC. `0` = không bắt buộc tấm nào, bộ đếm bỏ luôn mẫu số. */
  requiredPhotos: number;
  /** Trần số ảnh nhận vào; mặc định bằng số bắt buộc. Luôn bị kẹp bởi `PHOTO_MAX`. */
  max?: number;
  /** Tên nhóm ảnh — cũng là gốc của nhãn cho trình đọc màn hình. */
  title?: string;
  /**
   * Cấp tiêu đề của khối. Mặc định `h3` — đúng khi khối đứng thẳng trong thẻ.
   * Nằm trong một mục đã có tiêu đề riêng thì truyền `h4`, không thì trình đọc
   * màn hình nghe hai tiêu đề ngang hàng trong khi một cái là con của cái kia.
   */
  headingAs?: "h3" | "h4";
  onChange: (photos: PhotoItem[]) => void;
  /** Đang gửi biểu mẫu — khoá lại để không ai đổi ảnh giữa chừng. */
  busy?: boolean;
};

/**
 * Ảnh chứng minh (spec §4.7): số lượng bắt buộc theo cấu hình ngân hàng, nội
 * dung không duyệt.
 *
 * Dùng lại được cho ẢNH GIAO DỊCH của bước 3 (spec §4.2) bằng `title` + `max`:
 * nhóm đó không bắt buộc tấm nào nên `requiredPhotos = 0`, và trần lấy theo
 * `PHOTO_MAX`. Hai nhóm ghi vào hai `kind` khác nhau ở máy chủ.
 *
 * ⚠️ CHỌN ẢNH KHÔNG TẢI LÊN NGAY (chốt 07/08). Ảnh nằm lại trong máy người dùng
 * cho tới lúc bấm Hoàn thành / Lưu, rồi mới đi một lượt. Bản trước tải ngay khi
 * thả: chọn nhầm tấm là đã tốn một lượt tải và một tấm rác nằm lại trên máy chủ,
 * mà đội KD chọn ảnh bằng ngón tay trên điện thoại ngoài trời.
 *
 * ⚠️ Nhưng thứ ĐI VÀO BẢN GHI vẫn phải là URL thật. Bản xa hơn nữa gửi thẳng
 * chuỗi `blob:…` lên lưu — nó CHẠY được (ảnh hiện ra, bộ đếm nhảy đủ, nút Hoàn
 * thành mở khoá) nên lỗi không lộ lúc thử, nhưng `blob:` chỉ sống trong đúng tab
 * đang mở: tải lại trang là ảnh vỡ vĩnh viễn, mà tài khoản thì đã tiêu một lượt
 * mã và đã vào điểm KPI. Nên `uploadPendingPhotos` phải chạy XONG trước khi gọi
 * đường ghi bản ghi.
 */
export function BankAccountPhotos({
  photos,
  requiredPhotos,
  max: rawMax = requiredPhotos,
  title = "Ảnh chứng minh",
  headingAs: Heading = "h3",
  onChange,
  busy = false,
}: Props) {
  /**
   * Kẹp bởi trần của máy chủ. `banks.required_photos` là số admin gõ ở P-60 và
   * không có trần riêng: đặt 25 thì người dùng chọn đủ 25 tấm, tải hết lên kho,
   * rồi mới nhận 400 vì đường ghi ảnh chỉ nhận `PHOTO_MAX`. Kẹp ở đây thì họ
   * dừng đúng chỗ máy chủ dừng.
   */
  const max = Math.min(rawMax, PHOTO_MAX);
  const noun = title.toLowerCase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Ô đang thay ảnh; `null` = đang thêm mới. */
  const replacingSlot = useRef<number | null>(null);
  const previews = useRef(new Set<string>());

  // `blob:` chiếm bộ nhớ tới khi được thu hồi, và trình duyệt không tự dọn khi
  // component biến mất. Đây là tài nguyên ngoài React nên đúng chỗ cho effect.
  useEffect(() => {
    const created = previews.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);

  const toPending = (file: File): PhotoItem | null => {
    // Chặn sớm ở trình duyệt để người dùng biết ngay, KHÔNG phải để tin tưởng —
    // máy chủ kiểm lại từ đầu bằng chữ ký đầu file.
    const problem = imageProblem(file);
    if (problem) {
      toast.fail(`${file.name}: ${problem}`);
      return null;
    }
    const preview = URL.createObjectURL(file);
    previews.current.add(preview);
    return { kind: "pending", file, preview };
  };

  /** Thu hồi `blob:` của một ô sắp biến mất; ô `saved` thì không có gì để thu. */
  const release = (photo: PhotoItem | undefined) => {
    if (photo?.kind !== "pending") return;
    URL.revokeObjectURL(photo.preview);
    previews.current.delete(photo.preview);
  };

  const openPicker = (slot: number | null) => {
    if (busy) return;
    replacingSlot.current = slot;
    fileInputRef.current?.click();
  };

  const handleFiles = (files: File[]) => {
    const slot = replacingSlot.current;
    replacingSlot.current = null;
    if (files.length === 0) return;

    if (slot !== null) {
      const next = toPending(files[0]);
      if (!next) return;
      release(photos[slot]);
      onChange(photos.map((photo, i) => (i === slot ? next : photo)));
      return;
    }

    const room = Math.max(0, max - photos.length);
    const picked = files
      .slice(0, room)
      .map(toPending)
      .filter((photo): photo is PhotoItem => photo !== null);

    if (files.length > room)
      toast.warn(`Chỗ này nhận tối đa ${max} ảnh — đã lấy ${picked.length} tấm đầu.`);
    if (picked.length > 0) onChange([...photos, ...picked]);
  };

  const removeAt = (slot: number) => {
    release(photos[slot]);
    onChange(photos.filter((_, i) => i !== slot));
  };

  const pendingCount = photos.filter((p) => p.kind === "pending").length;

  return (
    <div className={styles.photoSection}>
      <Heading className={styles.photoTitle}>
        {title} ({photos.length}
        {requiredPhotos > 0 ? `/${requiredPhotos}` : ""})
        {pendingCount > 0 && (
          <span className={styles.photoHint}>
            {pendingCount} tấm sẽ tải lên khi bạn bấm lưu
          </span>
        )}
      </Heading>

      <div className={styles.photoGrid}>
        {photos.map((photo, i) => {
          const src = photo.kind === "saved" ? photo.url : photo.preview;
          return (
            <div key={photo.kind === "saved" ? photo.url : photo.preview} className={styles.photoTile}>
              <a href={src} target="_blank" rel="noreferrer">
                <img src={src} alt={`${title} ${i + 1}`} className={styles.photo} />
              </a>
              {photo.kind === "pending" && <span className={styles.photoBadge}>Chưa tải lên</span>}
              <button
                type="button"
                className={styles.photoEdit}
                aria-label={`Thay ${noun} ${i + 1}`}
                disabled={busy}
                onClick={() => openPicker(i)}
              >
                <Pencil size={14} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.photoRemove}
                aria-label={`Bỏ ${noun} ${i + 1}`}
                disabled={busy}
                onClick={() => removeAt(i)}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}

        {photos.length < max && (
          <button
            type="button"
            className={styles.photoAdd}
            /* P-22 vẽ hai khối ảnh cạnh nhau — hai nút cùng tên "Thêm ảnh" thì
               người duyệt bằng danh sách nút không biết nút nào của khối nào. */
            aria-label={`Thêm ${noun}`}
            disabled={busy}
            onClick={() => openPicker(null)}
          >
            <ImagePlus size={20} aria-hidden />
            Thêm ảnh
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        // Chọn được nhiều tấm một lượt: ba tấm chứng minh chụp liền nhau nằm
        // cạnh nhau trong thư viện, bắt mở hộp chọn ba lần là ba lần cuộn tìm.
        multiple
        className={styles.hiddenInput}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          // Dọn ô chọn NGAY: giữ nguyên thì chọn lại đúng file đó lần nữa sẽ
          // không bắn sự kiện `change`.
          e.target.value = "";
          handleFiles(files);
        }}
      />
    </div>
  );
}

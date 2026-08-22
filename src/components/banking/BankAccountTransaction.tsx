"use client";

import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { PHOTO_MAX } from "@/lib/api/bankAccounts";
import { BankAccountPhotos, type PhotoItem } from "./BankAccountPhotos";
import styles from "./BankAccountTransaction.module.scss";

type Props = {
  /** `''` = chưa ghi nhận. */
  date: string;
  onDateChange: (date: string) => void;
  photos: PhotoItem[];
  onPhotosChange: (photos: PhotoItem[]) => void;
  busy?: boolean;
};

/**
 * BƯỚC 3 (spec §4.2) — ghi nhận khách đã phát sinh giao dịch.
 *
 * Chỉ hiện trên tài khoản ĐÃ hoàn thành, vì đây là việc xảy ra sau: hôm nay
 * nhân viên mở tài khoản cho khách, hôm sau quay lại chuyển khoản giúp, chụp
 * màn hình rồi mở đúng bản ghi đó điền vào.
 *
 * Ảnh ở đây đếm RIÊNG với ảnh chứng minh lúc mở tài khoản. Gộp chung thì tài
 * khoản thiếu ảnh chứng minh tự "đủ ảnh" nhờ mấy tấm chuyển khoản.
 */
export function BankAccountTransaction({
  date,
  onDateChange,
  photos,
  onPhotosChange,
  busy = false,
}: Props) {
  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Phát sinh giao dịch</h3>
      <DateField
        className={styles.date}
        label="Ngày giao dịch"
        value={date}
        onChange={onDateChange}
        disabled={busy}
        hint="Để trống nếu khách chưa giao dịch."
      />

      <BankAccountPhotos
        title="Ảnh giao dịch"
        /* Khối ảnh là mục CON của "Phát sinh giao dịch" ngay trên nó. */
        headingAs="h4"
        requiredPhotos={0}
        max={PHOTO_MAX}
        photos={photos}
        onChange={onPhotosChange}
        busy={busy}
      />
    </section>
  );
}

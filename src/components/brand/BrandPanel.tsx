import { clsx } from "clsx";
import Image from "next/image";
import { Logo } from "@/components/ui/Logo";
import styles from "./BrandPanel.module.css";

/**
 * Khối nhận diện công ty — chép lại bố cục thẻ giới thiệu của MGST.
 *
 * Dựng bằng HTML thay vì nhúng ảnh: chữ sắc nét ở mọi độ phân giải, sửa nội
 * dung không cần mở phần mềm ảnh.
 *
 * Màu cam #e8763a là màu thương hiệu lấy từ bộ nhận diện, cố ý KHÔNG dùng
 * --color-accent của design system — đây là khối thương hiệu, không phải
 * thành phần giao diện.
 */
export function BrandPanel({ className }: { className?: string }) {
  return (
    <div className={clsx(styles.panel, className)} aria-hidden>
      <div className={styles.wedge} />

      <Logo size={50} withCompanyName className={styles.top} />

      <div className={styles.photoRing}>
        <Image src="/brand/photo.jpg" alt="" width={318} height={318} sizes="318px" />
      </div>

      <div className={styles.bottom}>
        <span className={styles.legalForm}>CÔNG TY TNHH</span>
        <span className={styles.wordmark}>MINH GROUP ST</span>
        <span className={styles.slogan}>
          “Tiên phong số hóa - Hiệu quả bứt phá”
        </span>
      </div>
    </div>
  );
}

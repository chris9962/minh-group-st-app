import { clsx } from "clsx";
import Image from "next/image";
import styles from "./Logo.module.css";

type Props = {
  /** Cạnh của logo, tính bằng px. */
  size?: number;
  /** Hiện kèm tên công ty và câu định vị. */
  withAppName?: boolean;
  /** Hiện kèm tên công ty đầy đủ. */
  withCompanyName?: boolean;
  priority?: boolean;
  className?: string;
};

/**
 * Logo MGST. Ảnh cắt từ bộ nhận diện công ty, luôn bo tròn.
 * Đổi logo thì đổi đúng một chỗ: public/brand/logo.png.
 */
export function Logo({
  size = 32,
  withAppName = false,
  withCompanyName = false,
  priority = false,
  className,
}: Props) {
  const mark = (
    <Image
      src="/brand/logo.png"
      alt={withAppName || withCompanyName ? "" : "Minh Group ST"}
      width={size}
      height={size}
      priority={priority}
      className={styles.mark}
    />
  );

  if (!withAppName && !withCompanyName) {
    return className ? <span className={className}>{mark}</span> : mark;
  }

  return (
    <span className={clsx(styles.row, className)}>
      {mark}
      {withAppName && (
        <span className={styles.appName}>
          <strong>Minh Group ST</strong>
          <span>Tiên phong số hóa, Hiệu quả bứt phá</span>
        </span>
      )}
      {withCompanyName && (
        <span className={styles.companyName}>MINH GROUP ST</span>
      )}
    </span>
  );
}

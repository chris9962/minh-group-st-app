import Image from "next/image";
import styles from "./Logo.module.css";

type Props = {
  /** Cạnh của logo, tính bằng px. */
  size?: number;
  /** Hiện kèm tên app "MGST · Nền tảng nội bộ". */
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
      alt={withAppName || withCompanyName ? "" : "MGST"}
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
    <span className={[styles.row, className].filter(Boolean).join(" ")}>
      {mark}
      {withAppName && (
        <span className={styles.appName}>
          <strong>MGST</strong>
          <span>Nền tảng nội bộ</span>
        </span>
      )}
      {withCompanyName && (
        <span className={styles.companyName}>MINH GROUP ST</span>
      )}
    </span>
  );
}

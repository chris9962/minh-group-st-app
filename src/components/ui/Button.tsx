import { clsx } from "clsx";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Chiếm trọn bề ngang — dùng cho nút chính trên điện thoại. */
  block?: boolean;
  /** Nút lớn hơn, dễ bấm bằng ngón cái ngoài hiện trường. */
  large?: boolean;
  /** Nút vuông chỉ chứa icon — bắt buộc truyền kèm `aria-label`. */
  icon?: boolean;
  /** Chữ hiện khi rê chuột hoặc focus. Giữ ngắn — tooltip dài tràn khỏi mép bảng. */
  tooltip?: string;
};

/**
 * Nút dùng chung. Bọc class .btn của design system, KHÔNG tự đặt màu.
 * Cần dáng khác thì thêm variant ở đây, đừng style tại chỗ dùng.
 */
export function Button({
  variant = "primary",
  block = false,
  large = false,
  icon = false,
  tooltip,
  className,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      data-tooltip={tooltip}
      className={clsx(
        "btn",
        styles.base,
        `btn-${variant}`,
        block && "btn-block",
        large && styles.large,
        icon && `btn-icon ${styles.icon}`,
        className,
      )}
      {...rest}
    />
  );
}

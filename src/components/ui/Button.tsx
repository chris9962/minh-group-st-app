import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Chiếm trọn bề ngang — dùng cho nút chính trên điện thoại. */
  block?: boolean;
  /** Nút lớn hơn, dễ bấm bằng ngón cái ngoài hiện trường. */
  large?: boolean;
};

/**
 * Nút dùng chung. Bọc class .btn của design system, KHÔNG tự đặt màu.
 * Cần dáng khác thì thêm variant ở đây, đừng style tại chỗ dùng.
 */
export function Button({
  variant = "primary",
  block = false,
  large = false,
  className,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={[
        "btn",
        `btn-${variant}`,
        block && "btn-block",
        large && styles.large,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}

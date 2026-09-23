import { clsx } from "clsx";
import styles from "./Alert.module.css";

type Props = {
  /** `warning` là cảnh báo mềm — vẫn đi tiếp được. `error` là chặn cứng. */
  tone?: "info" | "warning" | "error";
  children: React.ReactNode;
  className?: string;
  /**
   * `false` = không gắn `role="alert"` dù là cảnh báo. Dùng cho nội dung tự
   * đổi theo giờ (đếm ngược): vùng `alert` đọc lại toàn bộ mỗi lần chữ đổi,
   * người dùng trình đọc màn hình nghe cùng một câu mỗi phút.
   */
  live?: boolean;
};

/**
 * Hộp thông báo.
 *
 * Màu KHÔNG được là kênh truyền đạt duy nhất — người mù màu và màn hình điện
 * thoại ngoài nắng đều không phân biệt được. Mỗi tone luôn kèm một ký hiệu.
 */
const MARK = { info: "", warning: "⚠️", error: "❌" } as const;

export function Alert({ tone = "info", children, className, live = true }: Props) {
  // `div` chứ không `p`: nơi gọi đặt cả danh sách vào trong, mà `p` không chứa được `ul`.
  return (
    <div
      className={clsx(styles.box, styles[tone], className)}
      role={tone === "info" || !live ? undefined : "alert"}
    >
      {MARK[tone] && <span aria-hidden>{MARK[tone]} </span>}
      {children}
    </div>
  );
}

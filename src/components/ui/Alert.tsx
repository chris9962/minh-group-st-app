import styles from "./Alert.module.css";

type Props = {
  /** `warning` là cảnh báo mềm — vẫn đi tiếp được. `error` là chặn cứng. */
  tone?: "info" | "warning" | "error";
  children: React.ReactNode;
  className?: string;
};

/**
 * Hộp thông báo.
 *
 * Màu KHÔNG được là kênh truyền đạt duy nhất — người mù màu và màn hình điện
 * thoại ngoài nắng đều không phân biệt được. Mỗi tone luôn kèm một ký hiệu.
 */
const MARK = { info: "", warning: "⚠️", error: "❌" } as const;

export function Alert({ tone = "info", children, className }: Props) {
  return (
    <p
      className={[styles.box, styles[tone], className].filter(Boolean).join(" ")}
      role={tone === "info" ? undefined : "alert"}
    >
      {MARK[tone] && <span aria-hidden>{MARK[tone]} </span>}
      {children}
    </p>
  );
}

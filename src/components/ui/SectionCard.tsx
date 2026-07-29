import styles from "./SectionCard.module.css";

type Props = {
  title: string;
  /** Icon nhỏ trước tiêu đề — giúp nhận ra khối khi cuộn nhanh. */
  icon?: React.ReactNode;
  /** Chú thích bên phải tiêu đề, ví dụ "7 ngày". */
  meta?: string;
  /**
   * `plain` bỏ nền và viền — dùng cho bảng.
   *
   * Bảng vốn đã có đường kẻ hàng để phân nhóm; đặt thêm một mảng nền màu
   * quanh nó chỉ làm trang nặng màu mà không thêm thông tin gì.
   */
  variant?: "card" | "plain";
  children: React.ReactNode;
  className?: string;
};

/** Khối nội dung có tiêu đề trên dashboard và các màn chi tiết. */
export function SectionCard({
  title,
  icon,
  meta,
  variant = "card",
  children,
  className,
}: Props) {
  return (
    <section
      className={[styles.card, variant === "plain" && styles.plain, className]
        .filter(Boolean)
        .join(" ")}
    >
      <header className={styles.head}>
        {icon && (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        )}
        <h2 className={styles.title}>{title}</h2>
        {meta && <span className={styles.meta}>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

import styles from "./SectionCard.module.css";

type Props = {
  title: string;
  /** Icon nhỏ trước tiêu đề — giúp nhận ra khối khi cuộn nhanh. */
  icon?: React.ReactNode;
  /** Chú thích bên phải tiêu đề, ví dụ "7 ngày". */
  meta?: string;
  /**
   * Điều khiển nằm ngang hàng tiêu đề, dạt phải — ô tích lọc, nút phụ.
   *
   * Đặt ở đây thay vì thả lên đầu phần nội dung: một ô tích đứng ngay trên
   * bảng trông như một hàng của bảng, và đẩy bảng tụt xuống một dòng.
   */
  action?: React.ReactNode;
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
  action,
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
        {action && <div className={styles.action}>{action}</div>}
      </header>
      {children}
    </section>
  );
}

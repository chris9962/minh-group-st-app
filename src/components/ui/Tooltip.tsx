import styles from "./Tooltip.module.css";

type Props = {
  /** Rỗng thì không bọc gì, phần tử bên trong hiện như thường. */
  content: string | null | undefined;
  children: React.ReactNode;
};

/**
 * Bóng chữ hiện ngay khi di chuột hoặc đưa tiêu điểm vào phần tử bên trong.
 *
 * Không dùng thuộc tính `title`: trình duyệt không hiện `title` trên nút
 * `disabled`, và khi hiện thì trễ khoảng một giây. Chữ luôn nằm trong DOM nên
 * trình đọc màn hình đọc được, kể cả khi nút mờ không nhận tiêu điểm.
 */
export function Tooltip({ content, children }: Props) {
  if (!content) return <>{children}</>;
  return (
    <span className={styles.wrap}>
      {children}
      <span role="tooltip" className={styles.tip}>
        {content}
      </span>
    </span>
  );
}

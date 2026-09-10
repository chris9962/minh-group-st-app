import { NotificationBell } from "./NotificationBell";
import styles from "./TopBar.module.scss";

type Props = {
  title: string;
  /**
   * Giữ tiêu đề hiện trên điện thoại. Chỉ Tổng quan cần — các màn khác đã có
   * tiêu đề ở thanh điều hướng đáy, in lại lần nữa chỉ chiếm chỗ của bộ lọc.
   */
  keepTitleOnMobile?: boolean;
  /** Thanh chọn phạm vi, bộ lọc… tuỳ từng trang. */
  children?: React.ReactNode;
};

export function TopBar({ title, keepTitleOnMobile = false, children }: Props) {
  return (
    <header className={styles.bar}>
      <h1 className={keepTitleOnMobile ? styles.titleKept : styles.title}>{title}</h1>
      {/* Chuông nằm trong `TopBar` chứ không do từng trang tự đặt: thông báo
          không thuộc màn nào, và bắt 29 trang cùng nhớ thêm một dòng là sớm
          muộn có màn quên. */}
      <div className={styles.tools}>
        {children}
        <NotificationBell />
      </div>
    </header>
  );
}

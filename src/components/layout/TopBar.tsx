"use client";

import { JumpSearch } from "./JumpSearch";
import { NotificationBell } from "./NotificationBell";
import { nameInitials } from "@/lib/format";
import { useSession } from "@/store/session";
import styles from "./TopBar.module.scss";

type Props = {
  title: string;
  /**
   * Hiện tiêu đề trên điện thoại. Mặc định có — thanh đáy chỉ có vài lối tắt
   * (Tổng quan, Khách hàng…), không mang tên màn đang mở như Bảo hiểm.
   * `false` khi cố ý nhường hết chỗ cho bộ lọc.
   */
  keepTitleOnMobile?: boolean;
  /**
   * Thanh Tổng quan: tên + lời chào bên trái, công cụ bên phải. `title` vẫn là
   * `<h1>` ẩn — trình đọc màn hình cần mốc trang, không phải tên người dùng.
   */
  welcome?: boolean;
  /** Thanh chọn phạm vi, bộ lọc… tuỳ từng trang. */
  children?: React.ReactNode;
};

export function TopBar({
  title,
  keepTitleOnMobile = true,
  welcome = false,
  children,
}: Props) {
  const user = useSession((s) => s.user);

  return (
    <header className={welcome ? `${styles.bar} ${styles.welcomeBar}` : styles.bar}>
      {welcome && user ? (
        <>
          <div className={styles.welcome}>
            <span className={styles.avatar} aria-hidden>
              {nameInitials(user.fullName)}
            </span>
            <div className={styles.welcomeText}>
              <p className={styles.welcomeName}>{user.fullName}</p>
              <p className={styles.welcomeHint}>Chào mừng trở lại</p>
            </div>
          </div>
          <h1 className="sr-only">{title}</h1>
        </>
      ) : (
        <h1 className={keepTitleOnMobile ? styles.titleKept : styles.title}>{title}</h1>
      )}
      {/* Chuông nằm trong `TopBar` chứ không do từng trang tự đặt: thông báo
          không thuộc màn nào, và bắt 29 trang cùng nhớ thêm một dòng là sớm
          muộn có màn quên. */}
      <div className={styles.tools}>
        {welcome && (
          <>
            <JumpSearch />
            <NotificationBell />
          </>
        )}
        {children}
        {!welcome && <NotificationBell />}
      </div>
    </header>
  );
}

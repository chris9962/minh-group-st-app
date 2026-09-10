import { ChevronRight } from "lucide-react";
import styles from "./SettingsList.module.css";

/**
 * Danh sách cài đặt kiểu iOS: nhóm bo góc, mỗi dòng một mục, nhãn bên trái và
 * điều khiển bên phải.
 *
 * Khác `SectionCard`: thẻ đó đựng nội dung tự do, còn khối này chỉ đựng DÒNG.
 * Mỗi dòng cao tối thiểu 44px theo §8 — đội KD bấm bằng ngón tay ngoài trời.
 *
 * Vạch ngăn giữa hai dòng thụt vào bằng lề trái của nhãn, không kéo hết bề
 * ngang. Đó là chi tiết làm khối trông thành một danh sách liền mạch thay vì
 * nhiều thẻ xếp chồng.
 */

export function SettingsGroup({
  title,
  children,
}: {
  /** Tiêu đề nhỏ phía trên nhóm. Bỏ trống thì nhóm đứng một mình. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.group}>
      {title && <h2 className={styles.groupTitle}>{title}</h2>}
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

type RowProps = {
  label: React.ReactNode;
  /** Chữ phụ dưới nhãn. Chỉ dùng khi thiếu nó thì người dùng không thao tác được. */
  detail?: React.ReactNode;
  /** Giá trị chỉ đọc, hiện bên phải. */
  value?: React.ReactNode;
  /** Điều khiển bên phải, ví dụ `Switch`. Không đi cùng `value`. */
  control?: React.ReactNode;
};

export function SettingsRow({ label, detail, value, control }: RowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.main}>
        <span className={styles.label}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
      {value !== undefined && <span className={styles.value}>{value}</span>}
      {control}
    </div>
  );
}

/**
 * Dòng bấm được — mở hộp thoại hoặc chạy một hành động.
 *
 * Là `<button>` thật chứ không phải `div` có `onClick`: bàn phím và trình đọc
 * màn hình cần biết đây là thứ bấm được.
 */
export function SettingsAction({
  label,
  detail,
  onClick,
  disabled,
  danger,
}: {
  label: React.ReactNode;
  detail?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.row} ${styles.action} ${danger ? styles.danger : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={styles.main}>
        <span className={styles.label}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>
      <ChevronRight size={17} className={styles.chevron} aria-hidden />
    </button>
  );
}

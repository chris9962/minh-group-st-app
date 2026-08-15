import { Logo } from "@/components/ui/Logo";
import styles from "./AppLoading.module.scss";

/**
 * Màn chờ giữa hai thời điểm: app đọc phiên ở localStorage, và app chuyển sang
 * màn khác khi đường dẫn hiện tại không mở được.
 *
 * Cả hai đều rất ngắn. Nhưng để trắng thì lần tải lại nào cũng chớp một nhịp
 * trắng, và người mạng chậm không biết app còn sống hay hỏng.
 */
export function AppLoading({ label = "Đang mở…" }: { label?: string }) {
  return (
    <div className={styles.wrap}>
      <Logo size={44} priority className={styles.mark} />
      {/* `status` chứ không phải `alert`: trình đọc màn hình đọc lên khi rảnh,
          không cắt ngang thứ người dùng đang nghe. */}
      <p role="status" className={styles.label}>
        {label}
      </p>
    </div>
  );
}

"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "./Button";
import styles from "./ErrorState.module.scss";

type Props = {
  /** Hỏng cái gì, nói bằng tên người dùng biết: "danh sách nhân viên", "hồ sơ khách hàng". */
  what: string;
  /** Hàm tải lại. TanStack Query trả sẵn `refetch` — truyền thẳng vào. */
  onRetry?: () => void;
  retrying?: boolean;
};

/**
 * Báo lỗi khi không tải được dữ liệu.
 *
 * Luôn kèm nút TẢI LẠI. Trước đây mỗi trang chỉ in một dòng chữ "Không tải
 * được…", người dùng hết đường ngoài việc bấm F5 cả trang — mà phần lớn ca hỏng
 * là mạng chập một nhịp, tải lại đúng khối đó là xong.
 *
 * `role="alert"` để trình đọc màn hình báo ngay, không đợi người dùng dò tới.
 */
export function ErrorState({ what, onRetry, retrying = false }: Props) {
  return (
    <div className={styles.box} role="alert">
      <TriangleAlert size={18} className={styles.icon} aria-hidden />
      <p className={styles.title}>Không tải được {what}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          <RotateCw size={15} aria-hidden />
          {retrying ? "Đang tải lại…" : "Tải lại"}
        </Button>
      )}
    </div>
  );
}

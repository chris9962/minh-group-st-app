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
 * `role="alert"` đặt trên DÒNG CHỮ, không bọc cả khối: vùng `alert` là vùng
 * sống, mọi thay đổi bên trong đều được đọc lại và đọc chen ngang. Bọc cả nút
 * thì mỗi lần nhãn đổi "Tải lại" ↔ "Đang tải lại…" là trình đọc màn hình xướng
 * lại nguyên câu lỗi, hai lần cho một cú bấm.
 *
 * Nút dùng `aria-disabled` chứ không `disabled`: `disabled` gỡ luôn tiêu điểm
 * đang nằm trên chính nút đó, người dùng bàn phím bị văng về đầu trang giữa
 * chừng.
 */
export function ErrorState({ what, onRetry, retrying = false }: Props) {
  return (
    <div className={styles.box}>
      <TriangleAlert size={18} className={styles.icon} aria-hidden />
      <p className={styles.title} role="alert">
        Không tải được {what}
      </p>
      {onRetry && (
        <Button
          variant="secondary"
          onClick={() => {
            if (!retrying) onRetry();
          }}
          aria-disabled={retrying || undefined}
        >
          <RotateCw size={15} aria-hidden />
          {retrying ? "Đang tải lại…" : "Tải lại"}
        </Button>
      )}
    </div>
  );
}

"use client";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import styles from "./ConfirmDialog.module.css";

type Props = {
  open: boolean;
  title: string;
  /** Câu hỏi chính — nói rõ thao tác sẽ làm gì với AI, không nói chung chung. */
  children: React.ReactNode;
  /**
   * Hệ quả người dùng cần biết trước khi bấm. Hiện trong khối cảnh báo có icon,
   * không chỉ dựa vào màu (đội KD dùng điện thoại ngoài nắng).
   */
  consequence?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Hỏi lại trước khi làm một việc khó lùi.
 *
 * Nút xác nhận nằm CUỐI trong thứ tự tiêu điểm — `<dialog open>` giao tiêu điểm
 * cho phần tử bấm được đầu tiên, ở đây là nút Đóng trên đầu hộp thoại. Nhờ vậy
 * gõ Enter theo quán tính là ĐÓNG chứ không phải xác nhận; muốn xác nhận thì
 * phải chủ động Tab tới hoặc bấm chuột. Đã kiểm bằng trình duyệt thật: mở hộp
 * thoại khoá tài khoản rồi gõ Enter thì hộp thoại đóng và tài khoản còn nguyên.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  consequence,
  confirmLabel,
  cancelLabel = "Huỷ",
  pending = false,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Đang xử lý…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.question}>{children}</p>
      {consequence && <Alert tone="warning">{consequence}</Alert>}
    </Dialog>
  );
}

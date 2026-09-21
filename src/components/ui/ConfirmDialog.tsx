"use client";

import type { ReactNode } from "react";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import styles from "./ConfirmDialog.module.css";

export type ConfirmFact = { label: string; value: ReactNode };

/**
 * Bảng thông tin trong hộp xác nhận — mỗi trường một nhãn, không nhét vào
 * một câu bằng dấu chấm giữa. Điện thoại xếp một cột; đủ chỗ thì hai cột.
 */
export function ConfirmFacts({ items }: { items: ConfirmFact[] }) {
  return (
    <dl className={styles.facts}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

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
  /**
   * Đang chạy thì mọi lối đóng đều khoá: nút Huỷ, dấu X, phím Esc, bấm nền.
   *
   * Không khoá thì "Huỷ" nói dối — request đã bay đi rồi, đóng hộp thoại không
   * gọi nó về được. Người dùng bấm Huỷ, hộp thoại biến mất, và tài khoản vẫn bị
   * khoá vài trăm mili giây sau đó.
   */
  const requestClose = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={requestClose}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Đang xử lý…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.question}>{children}</div>
      {consequence && <Alert tone="warning">{consequence}</Alert>}
    </Dialog>
  );
}

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./TextField.module.css";

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  /** Hiện dấu * cạnh nhãn và đánh dấu aria-required — KHÔNG bật validation của trình duyệt. */
  required?: boolean;
  /** Thông báo lỗi. Có giá trị thì ô được đánh dấu aria-invalid. */
  error?: string;
  /** Chú thích dưới ô nhập. */
  hint?: string;
  /** Nội dung dán thêm vào cuối hàng nhãn — bộ đếm ký tự, chữ "không bắt buộc". */
  labelAppend?: React.ReactNode;
  ref?: React.Ref<HTMLTextAreaElement>;
};

/**
 * Ô nhập NHIỀU DÒNG có nhãn.
 *
 * Dùng chung `TextField.module.css`: nhãn, chú thích và câu lỗi phải trông y
 * hệt ô một dòng đứng cạnh nó trong cùng biểu mẫu. Chép ra file css riêng là
 * hai bản của một thứ, và chúng lệch nhau ngay lần đổi khoảng cách đầu tiên.
 *
 * `resize: vertical` để trong `.textarea` — người nhập kéo cao ra được khi
 * viết hướng dẫn dài, nhưng không kéo ngang làm vỡ bố cục hộp thoại.
 */
export function TextArea({
  label,
  required,
  error,
  hint,
  labelAppend,
  className,
  rows = 6,
  ref,
  ...rest
}: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(" ");

  return (
    <div className={clsx(styles.field, className)}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden>
            {" *"}
          </span>
        )}
        {labelAppend}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        className={clsx("input", styles.textarea)}
        aria-required={required || undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {hint && !error && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

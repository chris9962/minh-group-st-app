import { useId } from "react";
import styles from "./TextField.module.css";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  /** Thông báo lỗi. Có giá trị thì input được đánh dấu aria-invalid. */
  error?: string;
  /** Chú thích dưới ô nhập, ví dụ "đủ 12 số". */
  hint?: string;
  ref?: React.Ref<HTMLInputElement>;
};

/**
 * Ô nhập có nhãn.
 *
 * Nhãn LUÔN liên kết với input qua id — bắt buộc cho trình đọc màn hình,
 * và bấm vào nhãn thì con trỏ nhảy vào ô.
 */
export function TextField({ label, error, hint, className, ref, ...rest }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(" ");

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={ref}
        className="input"
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

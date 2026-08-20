import { clsx } from "clsx";
import { useId } from "react";
import styles from "./TextField.module.css";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  /** Hiện dấu * cạnh nhãn và đánh dấu aria-required — KHÔNG bật validation của trình duyệt. */
  required?: boolean;
  /** Thông báo lỗi. Có giá trị thì input được đánh dấu aria-invalid. */
  error?: string;
  /** Chú thích dưới ô nhập, ví dụ "đủ 12 số". */
  hint?: string;
  /**
   * Nội dung dán thêm vào cuối hàng nhãn — bộ đếm ký tự, chữ "không bắt buộc",
   * một liên kết nhỏ.
   *
   * Khe cắm chứ không phải một prop cho từng nhu cầu: nơi gọi đã có sẵn giá trị
   * và luật của nó, `TextField` không cần biết thứ dán vào là gì.
   */
  labelAppend?: React.ReactNode;
  /** Nút hoặc ký hiệu nằm đè bên phải trong ô — nút hiện mật khẩu, đơn vị tiền. */
  trailing?: React.ReactNode;
  ref?: React.Ref<HTMLInputElement>;
};

/**
 * Ô nhập có nhãn.
 *
 * Nhãn LUÔN liên kết với input qua id — bắt buộc cho trình đọc màn hình,
 * và bấm vào nhãn thì con trỏ nhảy vào ô.
 */
export function TextField({
  label,
  required,
  error,
  hint,
  labelAppend,
  trailing,
  className,
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
      <div className={styles.control}>
        <input
          id={id}
          ref={ref}
          className={clsx("input", trailing && styles.withTrailing)}
          aria-required={required || undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          {...rest}
        />
        {trailing}
      </div>
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

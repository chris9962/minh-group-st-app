"use client";

import { useId } from "react";
import styles from "./Select.module.css";

export type SelectOption = { value: string; label: string };

type Props = {
  label: string;
  /** Ẩn nhãn khỏi màn hình nhưng trình đọc màn hình vẫn đọc được. */
  hideLabel?: boolean;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Hiện dấu * cạnh nhãn và đánh dấu `aria-required` — KHÔNG bật validation của trình duyệt. */
  required?: boolean;
  /** Thông báo lỗi. Có giá trị thì ô chọn được đánh dấu `aria-invalid` và nối vào câu lỗi. */
  error?: string;
  /** Câu giải thích dưới ô chọn. Câu lỗi che nó — hai dòng chồng nhau đọc rối. */
  hint?: string;
  /**
   * Nhãn xếp phía trên, ô chọn rộng hết cỡ — dùng khi đứng cùng hàng với
   * `TextField` trong form. Mặc định nhãn nằm bên trái, hợp cho thanh lọc.
   */
  block?: boolean;
};

/**
 * Ô chọn.
 *
 * Dùng `<select>` gốc của trình duyệt thay vì tự dựng: trên điện thoại nó mở
 * bộ chọn của hệ điều hành, gõ phím nhảy đúng mục, và không cần thêm mã nào
 * cho bàn phím. Danh sách tự dựng chỉ hơn về hình thức.
 */
export function Select({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  disabled,
  required,
  error,
  hint,
  block = false,
}: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(" ");

  return (
    <span className={block ? styles.blockWrap : styles.wrap}>
      <label
        htmlFor={id}
        className={hideLabel ? "sr-only" : block ? styles.blockLabel : styles.label}
      >
        {label}
        {required && (
          <span className={styles.required} aria-hidden>
            {" *"}
          </span>
        )}
      </label>
      <select
        id={id}
        className={`input ${styles.select} ${block ? styles.blockSelect : ""}`}
        value={value}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {/*
        Câu lỗi phải NỐI vào ô chọn, không đứng rời. Để rời thì người dùng trình
        đọc màn hình bấm Lưu, form bị chặn, mà không nghe thấy gì — hộp thoại
        trông như treo.
      */}
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
    </span>
  );
}

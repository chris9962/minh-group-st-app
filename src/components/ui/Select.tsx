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
}: Props) {
  const id = useId();

  return (
    <span className={styles.wrap}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={`input ${styles.select}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

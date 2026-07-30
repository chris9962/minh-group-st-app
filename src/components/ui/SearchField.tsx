"use client";

import { Search, X } from "lucide-react";
import { useId } from "react";
import styles from "./SearchField.module.css";

type Props = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
};

/**
 * Ô tìm kiếm.
 *
 * Nút xoá tự dựng thay cho nút xoá mặc định của WebKit: nút mặc định chỉ hiện
 * trên Safari/Chrome, quá nhỏ để bấm bằng ngón tay, và không đọc được nhãn.
 */
export function SearchField({ label, placeholder, value, onChange }: Props) {
  const id = useId();

  return (
    <div className={styles.wrap}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className={styles.icon} size={15} aria-hidden />

      <input
        id={id}
        type="search"
        className={`input ${styles.input}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== "" && (
        <button
          type="button"
          className={styles.clear}
          onClick={() => onChange("")}
          aria-label={`Xoá ${label.toLowerCase()}`}
        >
          <X size={15} aria-hidden />
        </button>
      )}
    </div>
  );
}

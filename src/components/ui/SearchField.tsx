"use client";

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
      <label htmlFor={id} className="an-nhin">
        {label}
      </label>
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden focusable="false">
        <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M13.2 13.2 17 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
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
          <span aria-hidden>×</span>
        </button>
      )}
    </div>
  );
}

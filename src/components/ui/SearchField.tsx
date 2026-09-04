"use client";

import { Search, X } from "lucide-react";
import { useId } from "react";
import { SEARCH_MAX_LENGTH } from "@/lib/search";
import styles from "./SearchField.module.scss";

type Props = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Ô rộng hết cỡ — dùng khi đứng một mình trong hộp thoại, không phải chen giữa các control khác trên TopBar. */
  block?: boolean;
};

/**
 * Ô tìm kiếm.
 *
 * Nút xoá tự dựng thay cho nút xoá mặc định của WebKit: nút mặc định chỉ hiện
 * trên Safari/Chrome, quá nhỏ để bấm bằng ngón tay, và không đọc được nhãn.
 */
export function SearchField({ label, placeholder, value, onChange, block = false }: Props) {
  const id = useId();

  return (
    <div className={block ? styles.blockWrap : styles.wrap}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className={styles.icon} size={15} aria-hidden />

      <input
        id={id}
        type="search"
        className={`input ${styles.input} ${block ? styles.blockInput : ""}`}
        value={value}
        placeholder={placeholder}
        maxLength={SEARCH_MAX_LENGTH}
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

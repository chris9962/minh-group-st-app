"use client";

import { Plus } from "lucide-react";
import styles from "./NoteSuggestions.module.scss";

const partsOf = (note: string) =>
  note
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

type Props = {
  value: string;
  options: string[];
  onChange: (next: string) => void;
  /** Tên ô ghi chú trong nhãn đọc màn hình, ví dụ "lý do lỗi". */
  fieldLabel: string;
};

/**
 * Chip gợi ý chèn vào một ô ghi chú. Mỗi gợi ý là một đoạn ngăn bằng `; `, nên
 * chữ người dùng tự gõ vẫn giữ nguyên. Gợi ý đã có trong ô thì ẩn.
 */
export function NoteSuggestions({ value, options, onChange, fieldLabel }: Props) {
  const parts = partsOf(value);
  const suggestions = options.filter((option) => !parts.includes(option));
  if (suggestions.length === 0) return null;

  return (
    <div className={styles.suggestions}>
      <span className={styles.lead}>Gợi ý</span>
      {suggestions.map((option) => (
        <button
          key={option}
          type="button"
          className={styles.chip}
          aria-label={`Thêm "${option}" vào ${fieldLabel}`}
          onClick={() => onChange([...parts, option].join("; "))}
        >
          <Plus size={14} aria-hidden />
          {option}
        </button>
      ))}
    </div>
  );
}

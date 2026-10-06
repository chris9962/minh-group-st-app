"use client";

import { Plus } from "lucide-react";
import { TextArea } from "@/components/ui/TextArea";
import styles from "./BankAccountErrorNoteField.module.scss";

const COMMON_REASONS = ["STK không đúng", "Tên không đúng", "MGT không đúng", "Thiếu ảnh"];

const partsOf = (note: string) =>
  note
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

type Props = {
  value: string;
  onChange: (next: string) => void;
};

/**
 * Ô lý do đánh lỗi tài khoản (chốt 2026-10-06): bấm gợi ý để chèn lỗi hay gặp
 * thay cho gõ tay. Mỗi lỗi là một đoạn ngăn bằng `; ` trong cùng chuỗi
 * `errorNote`, nên lý do điền sẵn từ kiểm ảnh vẫn giữ nguyên.
 */
export function BankAccountErrorNoteField({ value, onChange }: Props) {
  const parts = partsOf(value);
  const suggestions = COMMON_REASONS.filter((reason) => !parts.includes(reason));

  return (
    <div className={styles.field}>
      <TextArea
        label="Lý do lỗi"
        required
        rows={3}
        placeholder="Ví dụ: Tài khoản không hợp lệ khi đối soát"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {suggestions.length > 0 && (
        <div className={styles.suggestions}>
          <span className={styles.lead}>Gợi ý</span>
          {suggestions.map((reason) => (
            <button
              key={reason}
              type="button"
              className={styles.chip}
              aria-label={`Thêm "${reason}" vào lý do lỗi`}
              onClick={() => onChange([...parts, reason].join("; "))}
            >
              <Plus size={14} aria-hidden />
              {reason}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

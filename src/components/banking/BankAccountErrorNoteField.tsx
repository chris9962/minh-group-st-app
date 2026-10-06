"use client";

import { Checkbox } from "@/components/ui/Checkbox";
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
 * Ô lý do đánh lỗi tài khoản (chốt 2026-10-06): tích lỗi hay gặp thay cho gõ
 * tay. Mỗi lỗi là một đoạn ngăn bằng `; ` trong cùng chuỗi `errorNote`, nên ô
 * chữ vẫn sửa tự do và lý do điền sẵn từ kiểm ảnh vẫn giữ nguyên.
 */
export function BankAccountErrorNoteField({ value, onChange }: Props) {
  const parts = partsOf(value);
  const toggle = (reason: string, on: boolean) =>
    onChange((on ? [...parts, reason] : parts.filter((part) => part !== reason)).join("; "));

  return (
    <div className={styles.field}>
      <fieldset className={styles.group}>
        <legend className={styles.title}>Lỗi hay gặp</legend>
        <div className={styles.options}>
          {COMMON_REASONS.map((reason) => (
            <Checkbox
              key={reason}
              label={reason}
              checked={parts.includes(reason)}
              onCheckedChange={(on) => toggle(reason, on)}
            />
          ))}
        </div>
      </fieldset>
      <TextArea
        label="Lý do lỗi"
        required
        rows={3}
        placeholder="Ví dụ: Tài khoản không hợp lệ khi đối soát"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

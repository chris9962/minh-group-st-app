"use client";

import { Checkbox } from "@/components/ui/Checkbox";
import { NoteSuggestions } from "@/components/ui/NoteSuggestions";
import { TextArea } from "@/components/ui/TextArea";
import styles from "./BankAccountErrorNoteField.module.scss";

const COMMON_REASONS = [
  "STK KHÔNG ĐÚNG",
  "TÊN KHÔNG ĐÚNG",
  "TK LỖI: SAI MÃ GIỚI THIỆU",
  "ẢNH KHÔNG ĐÚNG NGÂN HÀNG",
  "ẢNH KHÔNG CÙNG 1 TÀI KHOẢN",
  "THIẾU ẢNH GIAO DỊCH",
];

type Props = {
  value: string;
  onChange: (next: string) => void;
  locked: boolean;
  onLockedChange: (next: boolean) => void;
};

/**
 * Ô lý do đánh lỗi tài khoản (chốt 2026-10-06): bấm gợi ý để chèn lỗi hay gặp
 * thay cho gõ tay. Mỗi lỗi là một đoạn ngăn bằng `; ` trong cùng chuỗi
 * `errorNote`, nên lý do điền sẵn từ kiểm ảnh vẫn giữ nguyên.
 */
export function BankAccountErrorNoteField({ value, onChange, locked, onLockedChange }: Props) {
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
      <NoteSuggestions
        value={value}
        options={COMMON_REASONS}
        onChange={onChange}
        fieldLabel="lý do lỗi"
      />
      <Checkbox checked={locked} onCheckedChange={onLockedChange} label="Không cho sửa" />
    </div>
  );
}

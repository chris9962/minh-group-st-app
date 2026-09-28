"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";
import styles from "./BankSwitcher.module.scss";

type Props = {
  value: string;
  banks: { id: string; code: string }[];
  onChange: (bankId: string) => void;
};

/**
 * Tiêu đề trang chi tiết ngân hàng, bấm để sang ngân hàng khác (chốt 2026-09-28).
 *
 * `<select>` gốc cùng lý do với `Select`: điện thoại mở bộ chọn của hệ điều
 * hành, bàn phím chạy sẵn. Dáng riêng vì nó đứng ở chỗ tiêu đề, không phải ô lọc.
 */
export function BankSwitcher({ value, banks, onChange }: Props) {
  const id = useId();
  return (
    <span className={styles.wrap}>
      <label htmlFor={id} className="sr-only">
        Chọn ngân hàng
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {banks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code || "Ngân hàng"}
          </option>
        ))}
      </select>
      <ChevronDown size={18} aria-hidden className={styles.icon} />
    </span>
  );
}

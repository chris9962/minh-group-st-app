"use client";

import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import styles from "./Checkbox.module.css";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  name?: string;
  onBlur?: () => void;
  disabled?: boolean;
};

/**
 * Ô tích có nhãn.
 *
 * Dùng Radix để có sẵn hành vi bàn phím (Space để tích, focus thấy được).
 * Tự vẽ bằng div là sẽ thiếu một trong số đó.
 *
 * Dấu tích là SVG, KHÔNG dùng ký tự "✓": ký tự chữ mang theo baseline và khoảng
 * đệm hai bên của font, nên `place-items: center` canh giữa cái khung chữ chứ
 * không canh giữa nét vẽ — kết quả là dấu tích lệch xuống và lệch phải.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  name,
  onBlur,
  disabled,
}: Props) {
  return (
    <label className={styles.row}>
      <RadixCheckbox.Root
        className={styles.box}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        name={name}
        onBlur={onBlur}
        disabled={disabled}
      >
        <RadixCheckbox.Indicator className={styles.mark} aria-hidden>
          <Check size={14} strokeWidth={3.2} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label}
    </label>
  );
}

"use client";

import * as RadixCheckbox from "@radix-ui/react-checkbox";
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
        <RadixCheckbox.Indicator aria-hidden>✓</RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label}
    </label>
  );
}

"use client";

import { Button } from "./Button";
import styles from "./MonthPicker.module.css";

/** `YYYY-MM`. Dùng chuỗi thay vì Date để làm khoá truy vấn cho ổn định. */
export type Month = string;

export const thisMonth = (): Month => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const shift = (month: Month, delta: number): Month => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const monthLabel = (month: Month): string => {
  const [y, m] = month.split("-");
  return `Tháng ${Number(m)}/${y}`;
};

type Props = {
  value: Month;
  onChange: (month: Month) => void;
};

/** Chọn tháng. Chỉ tiêu tính theo tháng nên đây là đơn vị tự nhiên, không phải khoảng ngày. */
export function MonthPicker({ value, onChange }: Props) {
  const atCurrent = value >= thisMonth();

  return (
    <div className={styles.wrap}>
      <Button
        variant="secondary"
        aria-label="Tháng trước"
        onClick={() => onChange(shift(value, -1))}
      >
        ‹
      </Button>
      <span className={styles.label}>{monthLabel(value)}</span>
      <Button
        variant="secondary"
        aria-label="Tháng sau"
        disabled={atCurrent}
        onClick={() => onChange(shift(value, 1))}
      >
        ›
      </Button>
    </div>
  );
}

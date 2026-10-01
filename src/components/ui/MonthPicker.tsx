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
  /** Số tháng được đi quá tháng hiện tại. Màn Chỉ tiêu tháng nhập trước chỉ tiêu tháng sau nên đặt 1. */
  monthsAhead?: number;
  /** Tháng nhỏ nhất được lùi về. Không truyền thì lùi tuỳ ý. */
  minMonth?: Month;
};

/** Chọn tháng. Chỉ tiêu tính theo tháng nên đây là đơn vị tự nhiên, không phải khoảng ngày. */
export function MonthPicker({ value, onChange, monthsAhead = 0, minMonth }: Props) {
  const atLimit = value >= shift(thisMonth(), monthsAhead);
  const atStart = minMonth !== undefined && value <= minMonth;

  return (
    <div className={styles.wrap}>
      <Button
        variant="secondary"
        aria-label="Tháng trước"
        disabled={atStart}
        onClick={() => onChange(shift(value, -1))}
      >
        ‹
      </Button>
      <span className={styles.label}>{monthLabel(value)}</span>
      <Button
        variant="secondary"
        aria-label="Tháng sau"
        disabled={atLimit}
        onClick={() => onChange(shift(value, 1))}
      >
        ›
      </Button>
    </div>
  );
}

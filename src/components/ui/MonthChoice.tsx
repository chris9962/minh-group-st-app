"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "./Button";
import { thisMonth, type Month } from "./MonthPicker";
import styles from "./MonthChoice.module.css";

type Props = {
  label: string;
  /** `YYYY-MM`. Chuỗi rỗng = chưa chọn tháng nào. */
  value: Month | "";
  onChange: (month: Month | "") => void;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * Chọn MỘT tháng của một năm, dùng trong cột phải của `FilterButton`.
 *
 * Khác `MonthPicker`: ở đây được để trống, và đi được tới tháng sau tháng hiện
 * tại. Bấm lại tháng đang chọn là bỏ chọn.
 */
export function MonthChoice({ label, value, onChange }: Props) {
  const [year, setYear] = useState(() => Number((value || thisMonth()).slice(0, 4)));

  return (
    <div className={styles.wrap}>
      <div className={styles.year}>
        <Button variant="secondary" aria-label="Năm trước" onClick={() => setYear(year - 1)}>
          ‹
        </Button>
        <span className={styles.yearLabel} aria-live="polite">
          Năm {year}
        </span>
        <Button variant="secondary" aria-label="Năm sau" onClick={() => setYear(year + 1)}>
          ›
        </Button>
      </div>

      <div className={styles.grid} role="group" aria-label={label}>
        {MONTHS.map((m) => {
          const month = `${year}-${String(m).padStart(2, "0")}`;
          const on = month === value;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              className={on ? `${styles.month} ${styles.monthOn}` : styles.month}
              onClick={() => onChange(on ? "" : month)}
            >
              {on && <Check size={14} strokeWidth={2.5} aria-hidden />}
              Tháng {m}
            </button>
          );
        })}
      </div>
    </div>
  );
}

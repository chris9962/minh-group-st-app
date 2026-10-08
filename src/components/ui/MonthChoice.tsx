"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "./Button";
import { shiftMonth } from "@/lib/period";
import { thisMonth, type Month } from "./MonthPicker";
import styles from "./MonthChoice.module.css";

type Props =
  | {
      label: string;
      range?: false;
      /** `YYYY-MM`. Chuỗi rỗng = chưa chọn tháng nào. */
      value: Month | "";
      onChange: (month: Month | "") => void;
    }
  | {
      label: string;
      /**
       * Chọn một khoảng tháng LIÊN TIẾP, vắt được qua năm. Bấm tháng ngoài
       * khoảng thì nới khoảng tới tháng đó; bấm tháng đầu hoặc cuối thì bỏ tháng
       * đó; bấm tháng giữa khoảng thì chọn lại từ tháng vừa bấm.
       */
      range: true;
      /** Các tháng `YYYY-MM` liên tiếp, tăng dần. */
      value: Month[];
      onChange: (months: Month[]) => void;
    };

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const monthsBetween = (a: Month, b: Month): Month[] => {
  const [from, to] = a < b ? [a, b] : [b, a];
  const months: Month[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) months.push(m);
  return months;
};

/**
 * Chọn MỘT tháng của một năm, dùng trong cột phải của `FilterButton`; có
 * `range` thì chọn một khoảng tháng liên tiếp.
 *
 * Khác `MonthPicker`: ở đây được để trống, và đi được tới tháng sau tháng hiện
 * tại. Bấm lại tháng đang chọn là bỏ chọn.
 */
export function MonthChoice(props: Props) {
  const { label } = props;
  const latest = props.range ? props.value.at(-1) : props.value;
  const [year, setYear] = useState(() => Number((latest || thisMonth()).slice(0, 4)));
  const isOn = (month: Month) =>
    props.range ? props.value.includes(month) : month === props.value;
  const toggle = (month: Month) => {
    if (!props.range) return props.onChange(month === props.value ? "" : month);
    const picked = props.value;
    const first = picked[0];
    const last = picked[picked.length - 1];
    if (!first) return props.onChange([month]);
    if (month < first) return props.onChange(monthsBetween(month, last));
    if (month > last) return props.onChange(monthsBetween(first, month));
    if (month === first) return props.onChange(picked.slice(1));
    if (month === last) return props.onChange(picked.slice(0, -1));
    props.onChange([month]);
  };

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
          const on = isOn(month);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              className={on ? `${styles.month} ${styles.monthOn}` : styles.month}
              onClick={() => toggle(month)}
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

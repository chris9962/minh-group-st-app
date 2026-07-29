"use client";

import { useId } from "react";
import { MonthPicker, thisMonth, type Month } from "./MonthPicker";
import type { PeriodMode } from "@/lib/api/people";
import styles from "./PeoplePeriodPicker.module.css";

type Props = {
  value: PeriodMode;
  onChange: (period: PeriodMode) => void;
};

/**
 * Chọn kỳ cho màn nhân sự: hôm nay · tháng này · một tháng bất kỳ.
 *
 * Khác bộ chọn kỳ của dashboard vì ở đây đơn vị là THÁNG, không phải khoảng
 * ngày — chỉ tiêu tính theo tháng.
 */
export function PeoplePeriodPicker({ value, onChange }: Props) {
  const id = useId();

  return (
    <div className={styles.wrap}>
      <div className="seg" role="group" aria-label="Kỳ số liệu">
        <label className="seg-opt">
          <input
            type="radio"
            name={`${id}-period`}
            checked={value.kind === "today"}
            onChange={() => onChange({ kind: "today" })}
          />
          Hôm nay
        </label>
        <label className="seg-opt">
          <input
            type="radio"
            name={`${id}-period`}
            checked={value.kind === "this-month"}
            onChange={() => onChange({ kind: "this-month" })}
          />
          Tháng này
        </label>
        <label className="seg-opt">
          <input
            type="radio"
            name={`${id}-period`}
            checked={value.kind === "month"}
            onChange={() => onChange({ kind: "month", month: thisMonth() })}
          />
          Chọn tháng
        </label>
      </div>

      {value.kind === "month" && (
        <MonthPicker
          value={value.month}
          onChange={(month: Month) => onChange({ kind: "month", month })}
        />
      )}
    </div>
  );
}

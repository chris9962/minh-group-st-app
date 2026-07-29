"use client";

import { useId } from "react";
import type { DateRange } from "react-day-picker";
import { DateRangePicker } from "./DateRangePicker";
import styles from "./PeriodPicker.module.css";

export type Period =
  | { kind: "today" }
  | { kind: "this-month" }
  | { kind: "range"; range: DateRange | undefined };

export const DEFAULT_PERIOD: Period = { kind: "today" };

const iso = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/**
 * Khoá dùng cho queryKey và tham số API — một chuỗi ổn định cho mỗi kỳ.
 * Khoảng chưa chọn xong (mới có ngày đầu) coi như chưa đổi kỳ.
 */
export const periodKey = (p: Period): string => {
  if (p.kind !== "range") return p.kind;
  const { from, to } = p.range ?? {};
  return from && to ? `range:${iso(from)}:${iso(to)}` : "today";
};

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

type Props = {
  value: Period;
  onChange: (period: Period) => void;
};

/** Chọn kỳ xem số liệu: hôm nay · tháng này · khoảng ngày tự chọn. */
export function PeriodPicker({ value, onChange }: Props) {
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
            checked={value.kind === "range"}
            onChange={() =>
              onChange({
                kind: "range",
                range: { from: firstOfMonth(), to: new Date() },
              })
            }
          />
          Khoảng ngày
        </label>
      </div>

      {value.kind === "range" && (
        <DateRangePicker
          value={value.range}
          onChange={(range) => onChange({ kind: "range", range })}
        />
      )}

    </div>
  );
}

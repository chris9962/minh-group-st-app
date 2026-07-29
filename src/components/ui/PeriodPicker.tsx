"use client";

import { useId } from "react";
import styles from "./PeriodPicker.module.css";

export type Period =
  | { kind: "today" }
  | { kind: "this-month" }
  | { kind: "range"; from: string; to: string };

export const DEFAULT_PERIOD: Period = { kind: "today" };

/** Khoá dùng cho queryKey và tham số API — một chuỗi ổn định cho mỗi kỳ. */
export const periodKey = (p: Period): string =>
  p.kind === "range" ? `range:${p.from}:${p.to}` : p.kind;

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
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
              onChange({ kind: "range", from: firstOfMonth(), to: today() })
            }
          />
          Khoảng ngày
        </label>
      </div>

      {value.kind === "range" && (
        <div className={styles.range}>
          <label htmlFor={`${id}-from`} className="an-nhin">
            Từ ngày
          </label>
          <input
            id={`${id}-from`}
            type="date"
            className={`input ${styles.date}`}
            value={value.from}
            max={value.to}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span aria-hidden>→</span>
          <label htmlFor={`${id}-to`} className="an-nhin">
            Đến ngày
          </label>
          <input
            id={`${id}-to`}
            type="date"
            className={`input ${styles.date}`}
            value={value.to}
            min={value.from}
            max={today()}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

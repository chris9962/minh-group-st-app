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

/** Ngày sớm hơn trong hai ngày. */
const minDate = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);

/**
 * Cắt ngày cuối về cuối tháng của ngày đầu, khi màn đòi khoảng nằm trọn một
 * tháng. Không bật thì trả nguyên khoảng.
 */
const clampToMonth = (r: DateRange | undefined, on: boolean): DateRange | undefined => {
  if (!on || !r?.from || !r.to) return r;
  const last = new Date(r.from.getFullYear(), r.from.getMonth() + 1, 0);
  return r.to.getTime() > last.getTime() ? { from: r.from, to: last } : r;
};

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

/**
 * Kỳ quy về hai ngày `YYYY-MM-DD` — dạng mà route danh sách nào cũng nhận.
 *
 * Dùng khi máy chủ chỉ cần lọc theo khoảng. Route nào phải so với KỲ TRƯỚC để
 * vẽ mũi tên tăng giảm thì vẫn gửi `periodKey`, vì "kỳ trước của 05/08 đến
 * 12/08" là câu hỏi không có lời đáp — xem `periodRanges` ở `server/org.ts`.
 */
export const periodDates = (p: Period): { from: string; to: string } => {
  if (p.kind === "today") {
    const today = iso(new Date());
    return { from: today, to: today };
  }
  if (p.kind === "this-month") {
    const d = new Date();
    return { from: iso(firstOfMonth()), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  }
  const { from, to } = p.range ?? {};
  if (!from || !to) {
    const today = iso(new Date());
    return { from: today, to: today };
  }
  return { from: iso(from), to: iso(to) };
};

type Props = {
  value: Period;
  onChange: (period: Period) => void;
  /**
   * Khoảng ngày phải nằm TRỌN trong một tháng.
   *
   * Bật ở màn có cột ĐIỂM. Điểm KPI tính theo từng tháng và tổ hợp không nối
   * qua tháng (thể lệ câu 7.13), nên một khoảng vắt hai tháng ra con số không
   * ai đoán được: khách mở `VPa` ngày 30/08 và `MB` ngày 02/09 KHÔNG thành
   * Combo 2, dù cả hai đều nằm trong khoảng đang chọn.
   *
   * Màn chỉ đếm dòng thì không cần bật — đếm thì khoảng nào cũng cộng được.
   */
  sameMonthOnly?: boolean;
};

const lastOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth() + 1, 0);

/** Chọn kỳ xem số liệu: hôm nay · tháng này · khoảng ngày tự chọn. */
export function PeriodPicker({ value, onChange, sameMonthOnly = false }: Props) {
  const id = useId();

  /**
   * Đang chọn dở — đã bấm ngày đầu, chưa bấm ngày cuối. Lúc đó lịch khoá vào
   * tháng của ngày đầu, những ngày ngoài tháng mờ đi.
   *
   * Chỉ khoá lúc chọn dở, không khoá lúc đã xong: chọn xong rồi thì người dùng
   * phải bấm được sang tháng khác để bắt đầu khoảng mới.
   */
  const picking = sameMonthOnly && value.kind === "range" && value.range?.from && !value.range.to
    ? value.range.from
    : null;

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
          minDate={picking ? new Date(picking.getFullYear(), picking.getMonth(), 1) : undefined}
          maxDate={picking ? minDate(lastOfMonth(picking), new Date()) : new Date()}
          onChange={(range) =>
            onChange({
              kind: "range",
              // Lưới lịch đã khoá, dòng này chặn nốt đường còn lại: giá trị cũ
              // đọc từ URL, hoặc khoảng chọn xong trước khi bật `sameMonthOnly`.
              range: clampToMonth(range, sameMonthOnly),
            })
          }
        />
      )}

    </div>
  );
}

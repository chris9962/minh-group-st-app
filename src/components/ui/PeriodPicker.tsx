"use client";

import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { DateRange } from "react-day-picker";
import { businessDay } from "@/lib/format";
import {
  FILTER_PERIOD_KINDS,
  periodKindLabel,
  periodRanges,
  type PeriodKind,
} from "@/lib/period";
import { DateRangePicker } from "./DateRangePicker";
import styles from "./PeriodPicker.module.css";

export type Period =
  | { kind: "today" }
  | { kind: "this-month" }
  | { kind: "last-3-months" }
  | { kind: "last-6-months" }
  | { kind: "last-1-year" }
  | { kind: "range"; range: DateRange | undefined };

export { periodKindLabel };
export type { PeriodKind };

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

/**
 * Kỳ quy về hai ngày `YYYY-MM-DD` — dạng mà route danh sách nào cũng nhận.
 *
 * Dùng khi máy chủ chỉ cần lọc theo khoảng. Route nào phải so với KỲ TRƯỚC để
 * vẽ mũi tên tăng giảm thì vẫn gửi `periodKey`, vì "kỳ trước của 05/08 đến
 * 12/08" là câu hỏi không có lời đáp — xem `periodRanges` ở `lib/period.ts`.
 */
export const periodDates = (p: Period): { from: string; to: string } =>
  periodRanges(periodKey(p), businessDay()).current;

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
  /**
   * `toolbar`: ô chọn kỳ + viên thuốc khoảng ngày trên thanh trên.
   * Mặc định giữ cụm phân đoạn cho bộ lọc điện thoại.
   */
  variant?: "seg" | "toolbar";
  /** Danh sách preset. Mặc định hôm nay · tháng này · khoảng ngày. */
  kinds?: readonly PeriodKind[];
};

const parseDay = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const pickKind = (
  kind: PeriodKind,
  value: Period,
  range: { from: Date; to: Date },
  onChange: (period: Period) => void,
) => {
  if (kind === "range") {
    onChange({
      kind: "range",
      range: value.kind === "range" ? value.range : { from: range.from, to: range.to },
    });
    return;
  }
  onChange({ kind });
};

/** Chọn kỳ xem số liệu: hôm nay · tháng này · 3 tháng · 6 tháng · 1 năm · khoảng ngày. */
export function PeriodPicker({
  value,
  onChange,
  sameMonthOnly = false,
  variant = "seg",
  kinds = FILTER_PERIOD_KINDS,
}: Props) {
  const id = useId();
  const dates = periodDates(value);
  const range = { from: parseDay(dates.from), to: parseDay(dates.to) };

  /**
   * Lịch luôn hiện — preset chỉ là lối tắt. Ẩn lịch khi kind !== "range" thì
   * điện thoại (bỏ toolbar, nhét vào "Bộ lọc") mất hẳn chỗ chọn ngày.
   *
   * `range` không nằm trong `kinds` (Tổng quan) vẫn chọn được ngày; mục
   * "Khoảng ngày" chỉ thêm vào danh sách khi đang đứng ở kind đó, để nút hiện
   * đúng nhãn.
   */
  const menuKinds: readonly PeriodKind[] =
    kinds.includes("range") || value.kind !== "range" ? kinds : [...kinds, "range"];
  const pickedRange = value.kind === "range" ? (value.range ?? range) : range;

  if (variant === "toolbar") {
    const kindLabel = value.kind === "range" ? "Custom" : periodKindLabel(value.kind);
    return (
      <div className={styles.cluster} role="group" aria-label="Kỳ số liệu">
        <Popover.Root>
          <Popover.Trigger className={styles.kindBtn}>
            {kindLabel}
            <ChevronDown size={16} aria-hidden />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className={styles.kindPanel}
              align="start"
              sideOffset={6}
            >
              {menuKinds.map((kind) => (
                <Popover.Close asChild key={kind}>
                  <button
                    type="button"
                    className={styles.kindItem}
                    aria-current={value.kind === kind ? "true" : undefined}
                    onClick={() => pickKind(kind, value, range, onChange)}
                  >
                    {periodKindLabel(kind)}
                  </button>
                </Popover.Close>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <span className={styles.split} aria-hidden />
        <DateRangePicker
          value={pickedRange}
          sameMonthOnly={sameMonthOnly}
          appearance="chip"
          onChange={(next) => onChange({ kind: "range", range: next })}
        />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className="seg" role="group" aria-label="Kỳ số liệu">
        {menuKinds.map((kind) => (
          <label className="seg-opt" key={kind}>
            <input
              type="radio"
              name={`${id}-period`}
              checked={value.kind === kind}
              onChange={() =>
                pickKind(
                  kind,
                  value,
                  { from: firstOfMonth(), to: new Date() },
                  onChange,
                )
              }
            />
            {periodKindLabel(kind)}
          </label>
        ))}
      </div>

      <DateRangePicker
        value={pickedRange}
        sameMonthOnly={sameMonthOnly}
        onChange={(next) => onChange({ kind: "range", range: next })}
      />
    </div>
  );
}

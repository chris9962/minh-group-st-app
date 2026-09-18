"use client";

import { CalendarDays } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useId, useRef } from "react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import styles from "./DateRangePicker.module.css";

type Props = {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  /** Không cho chọn ngày sau hôm nay. */
  maxDate?: Date;
  /** Không cho chọn ngày trước mốc này. Bỏ trống nghĩa là không chặn phía trước. */
  minDate?: Date;
  /**
   * Có nhãn thì đổi sang dáng đứng: nhãn trên, ô rộng hết cỡ — cùng dáng
   * `block` của `Select` và `Combobox`, để bảng lọc xếp thẳng một cột.
   */
  label?: string;
  /** Ẩn nhãn khỏi màn hình — dùng khi tên mục đã nằm ở cột trái `FilterButton`. */
  hideLabel?: boolean;
  /**
   * Khoảng ngày phải nằm TRỌN trong một tháng.
   *
   * Bật ở màn có cột ĐIỂM. Điểm KPI tính theo từng tháng và tổ hợp không nối
   * qua tháng (thể lệ câu 7.13), nên một khoảng vắt hai tháng ra con số không
   * ai đoán được: khách mở `VPa` ngày 30/08 và `MB` ngày 02/09 KHÔNG thành
   * Combo 2, dù cả hai đều nằm trong khoảng đang chọn.
   */
  sameMonthOnly?: boolean;
  /**
   * Dáng viên thuốc trên thanh công cụ (Tổng quan): lịch + khoảng ngày, không
   * phải ô nhập `.input` của bộ lọc.
   */
  appearance?: "input" | "chip";
};

const show = (r: DateRange | undefined, chip: boolean) => {
  if (!r?.from) return "Chọn khoảng ngày";
  if (!chip) {
    const from = format(r.from, "dd/MM/yyyy");
    if (!r.to) return `${from} → …`;
    const to = format(r.to, "dd/MM/yyyy");
    return from === to ? from : `${from} → ${to}`;
  }
  const opts = { locale: vi };
  if (!r.to) return `${format(r.from, "dd MMM", opts)} - …`;
  if (format(r.from, "yyyy-MM-dd") === format(r.to, "yyyy-MM-dd")) {
    return format(r.from, "dd MMM, yyyy", opts);
  }
  if (r.from.getFullYear() === r.to.getFullYear()) {
    return `${format(r.from, "dd MMM", opts)} - ${format(r.to, "dd MMM, yyyy", opts)}`;
  }
  return `${format(r.from, "dd MMM, yyyy", opts)} - ${format(r.to, "dd MMM, yyyy", opts)}`;
};

/** Ngày sớm hơn trong hai ngày. */
const earlier = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);

const firstOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
const lastOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth() + 1, 0);

/**
 * Cắt ngày cuối về cuối tháng của ngày đầu, khi màn đòi khoảng nằm trọn một
 * tháng. Không bật thì trả nguyên khoảng.
 */
const clampToMonth = (r: DateRange | undefined, on: boolean): DateRange | undefined => {
  if (!on || !r?.from || !r.to) return r;
  const last = lastOfMonth(r.from);
  return r.to.getTime() > last.getTime() ? { from: r.from, to: last } : r;
};

/**
 * Chọn khoảng ngày bằng MỘT lịch: bấm ngày đầu rồi kéo tới ngày cuối.
 * Dùng react-day-picker vì tự viết lịch có khoảng là rất dễ sai ở tuần giao
 * tháng, năm nhuận và điều hướng bàn phím.
 */
export function DateRangePicker({
  value,
  onChange,
  maxDate = new Date(),
  minDate,
  label,
  hideLabel = false,
  sameMonthOnly = false,
  appearance = "input",
}: Props) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Đang chọn dở — đã bấm ngày đầu, chưa bấm ngày cuối. Lúc đó lịch khoá vào
   * tháng của ngày đầu, những ngày ngoài tháng mờ đi.
   *
   * Chỉ khoá lúc chọn dở, không khoá lúc đã xong: chọn xong rồi thì người dùng
   * phải bấm được sang tháng khác để bắt đầu khoảng mới.
   */
  const picking = sameMonthOnly && value?.from && !value.to ? value.from : null;
  const from = picking ? firstOfMonth(picking) : minDate;
  const to = picking ? earlier(lastOfMonth(picking), maxDate) : maxDate;

  const chip = appearance === "chip";
  const triggerClass = chip
    ? styles.chip
    : `input ${styles.trigger}${label ? ` ${styles.blockTrigger}` : ""}`;
  const trigger = (
    <Popover.Trigger
      ref={label ? triggerRef : undefined}
      id={label ? id : undefined}
      className={triggerClass}
    >
      {chip && <CalendarDays size={16} aria-hidden />}
      {show(value, chip)}
    </Popover.Trigger>
  );

  return (
    <Popover.Root>
      {/*
        Nhãn và ô phải nằm TRONG một khối bọc. `Popover.Root` không sinh thẻ
        DOM nào, nên để rời thì hai thứ thành hai ô của lưới bên ngoài và ăn
        nguyên khoảng cách 16px của lưới — nhãn rời hẳn khỏi ô của nó.
      */}
      {label ? (
        <span className={styles.blockWrap}>
          {/*
            Bấm vào nhãn KHÔNG mở lịch. Nhãn nằm ngay trên ô, mà lịch đang mở
            thì người dùng bấm hụt lên phía trên để đóng nó — trúng nhãn là
            lịch mở lại ngay.

            Vẫn giữ `htmlFor`/`id`: liên kết đó là thứ trình đọc màn hình đọc
            (AGENTS.md §8). Chỉ bỏ hành vi kích hoạt bằng chuột, bàn phím đi
            bằng Tab nên không đổi.
          */}
          <label
            htmlFor={id}
            className={hideLabel ? "sr-only" : styles.label}
            onMouseDown={(e) => {
              e.preventDefault();
              // Nhả con trỏ ra hẳn — xem chú thích cùng chỗ ở `Combobox`.
              triggerRef.current?.blur();
            }}
            onClick={(e) => e.preventDefault()}
          >
            {label}
          </label>
          {trigger}
        </span>
      ) : (
        trigger
      )}

      <Popover.Portal>
        <Popover.Content className={styles.panel} sideOffset={6} align="end">
          <DayPicker
            mode="range"
            locale={vi}
            numberOfMonths={2}
            defaultMonth={value?.from}
            selected={value}
            // Lưới lịch đã khoá, dòng này chặn nốt đường còn lại: giá trị cũ
            // đọc từ URL, hoặc khoảng chọn xong trước khi bật `sameMonthOnly`.
            onSelect={(range) => onChange(clampToMonth(range, sameMonthOnly))}
            disabled={from ? [{ after: to }, { before: from }] : { after: to }}
            className={styles.calendar}
          />
          <Popover.Arrow className={styles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

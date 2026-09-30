"use client";

import { CalendarDays } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useId, useRef, useState, useSyncExternalStore } from "react";
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

/** Cắt ngày cuối về cuối tháng của ngày đầu. */
const clampToMonth = (r: DateRange | undefined): DateRange | undefined => {
  if (!r?.from || !r.to) return r;
  const last = lastOfMonth(r.from);
  return r.to.getTime() > last.getTime() ? { from: r.from, to: last } : r;
};

const NARROW = "(max-width: 600px)";

/** Một tháng trên điện thoại; hai tháng cạnh nhau khi đủ chỗ. */
function useNarrowViewport() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/**
 * Chọn khoảng ngày bằng MỘT lịch: bấm ngày đầu rồi kéo tới ngày cuối.
 * Dùng react-day-picker vì tự viết lịch có khoảng là rất dễ sai ở tuần giao
 * tháng, năm nhuận và điều hướng bàn phím.
 *
 * Khoảng ngày luôn nằm TRỌN trong một tháng, ở mọi màn (chốt 2026-09-30). Điểm
 * KPI, tổ hợp (thể lệ câu 7.13) và nhân sự của phòng đều tính theo từng tháng,
 * nên một khoảng vắt hai tháng ra con số không ai đoán được: khách mở `VPa`
 * ngày 30/08 và `MB` ngày 02/09 KHÔNG thành Combo 2, dù cả hai đều nằm trong
 * khoảng đang chọn.
 */
export function DateRangePicker({
  value,
  onChange,
  maxDate = new Date(),
  minDate,
  label,
  hideLabel = false,
  appearance = "input",
}: Props) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const narrow = useNarrowViewport();

  /**
   * Đang chọn dở — đã bấm ngày đầu, chưa bấm ngày cuối. Lúc đó lịch khoá vào
   * tháng của ngày đầu, những ngày ngoài tháng mờ đi.
   *
   * Chỉ khoá lúc chọn dở, không khoá lúc đã xong: chọn xong rồi thì người dùng
   * phải bấm được sang tháng khác để bắt đầu khoảng mới.
   *
   * Ngày đầu giữ ở ĐÂY, chưa báo ra ngoài: màn nhận một khoảng mới có ngày đầu
   * sẽ lọc "từ ngày đó trở đi", tức vắt qua các tháng sau, và tải thừa một lượt.
   */
  const [picking, setPicking] = useState<Date | null>(null);
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
    // Đóng lịch giữa chừng thì bỏ ngày đầu đang chọn dở.
    <Popover.Root onOpenChange={(opened) => !opened && setPicking(null)}>
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
        <Popover.Content
          className={styles.panel}
          sideOffset={6}
          align={narrow ? "center" : "end"}
        >
          <DayPicker
            mode="range"
            locale={vi}
            numberOfMonths={narrow ? 1 : 2}
            defaultMonth={value?.from}
            selected={picking ? { from: picking, to: undefined } : value}
            // Đã có khoảng đủ hai đầu thì lượt bấm kế tiếp MỞ KHOẢNG MỚI. Không
            // có dòng này thư viện nối dài khoảng cũ, rồi `clampToMonth` cắt về
            // tháng cũ: người dùng không sang được tháng khác nếu chưa xoá lọc.
            resetOnSelect
            onSelect={(range) => {
              if (range?.from && !range.to) {
                setPicking(range.from);
                return;
              }
              setPicking(null);
              // Lưới lịch đã khoá, `clampToMonth` chặn nốt đường còn lại.
              onChange(clampToMonth(range));
            }}
            disabled={from ? [{ after: to }, { before: from }] : { after: to }}
            className={styles.calendar}
          />
          <Popover.Arrow className={styles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

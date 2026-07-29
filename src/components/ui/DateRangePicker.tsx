"use client";

import * as Popover from "@radix-ui/react-popover";
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
};

const show = (r: DateRange | undefined) => {
  if (!r?.from) return "Chọn khoảng ngày";
  const from = format(r.from, "dd/MM/yyyy");
  return r.to ? `${from} → ${format(r.to, "dd/MM/yyyy")}` : `${from} → …`;
};

/**
 * Chọn khoảng ngày bằng MỘT lịch: bấm ngày đầu rồi kéo tới ngày cuối.
 * Dùng react-day-picker vì tự viết lịch có khoảng là rất dễ sai ở tuần giao
 * tháng, năm nhuận và điều hướng bàn phím.
 */
export function DateRangePicker({ value, onChange, maxDate = new Date() }: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger className={`input ${styles.trigger}`}>
        {show(value)}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content className={styles.panel} sideOffset={6} align="end">
          <DayPicker
            mode="range"
            locale={vi}
            numberOfMonths={2}
            defaultMonth={value?.from}
            selected={value}
            onSelect={onChange}
            disabled={{ after: maxDate }}
            className={styles.calendar}
          />
          <Popover.Arrow className={styles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

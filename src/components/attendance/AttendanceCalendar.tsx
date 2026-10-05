"use client";

import { vi } from "date-fns/locale";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import styles from "./AttendanceCalendar.module.scss";

/** Ngày lịch của trình duyệt ↔ chuỗi `YYYY-MM-DD`, đọc theo giờ địa phương như DayPicker. */
const toDate = (iso: string) => new Date(`${iso}T00:00:00`);
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Props = {
  /** `YYYY-MM-DD`. */
  selected: string;
  /** `YYYY-MM` đang xem. */
  month: string;
  today: string;
  /** Ngày có chấm công, `YYYY-MM-DD`: tô xanh. */
  checkedDays: string[];
  onSelect: (day: string) => void;
  onMonthChange: (month: string) => void;
};

/** Lịch tháng chấm công: ngày có chấm tô xanh, không đi quá ngày hiện tại. */
export function AttendanceCalendar({ selected, month, today, checkedDays, onSelect, onMonthChange }: Props) {
  return (
    <DayPicker
      mode="single"
      locale={vi}
      required
      selected={toDate(selected)}
      onSelect={(d) => onSelect(toIso(d))}
      month={toDate(`${month}-01`)}
      onMonthChange={(d) => onMonthChange(toIso(d).slice(0, 7))}
      endMonth={toDate(today)}
      disabled={{ after: toDate(today) }}
      modifiers={{ checked: checkedDays.map(toDate) }}
      modifiersClassNames={{ checked: styles.checked }}
      className={styles.calendar}
    />
  );
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { vi } from "date-fns/locale";
import { Camera, CalendarCheck } from "lucide-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import {
  ATTENDANCE_SLOTS,
  fetchMyAttendance,
  slotLabel,
  type AttendanceCheck,
  type AttendanceSlot,
} from "@/lib/api/attendance";
import { businessDay, businessMonth, clockNowVn, formatDate } from "@/lib/format";
import { CameraCheckIn } from "./CameraCheckIn";
import { CheckDetailDialog } from "./CheckDetailDialog";
import styles from "./CheckInPanel.module.scss";

/** Ngày lịch của trình duyệt ↔ chuỗi `YYYY-MM-DD`, đọc theo giờ địa phương như DayPicker. */
const toDate = (iso: string) => new Date(`${iso}T00:00:00`);
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Lịch tháng của chính mình: ngày có chấm công tô xanh, bấm ngày nào thì hiện 4 lượt của ngày đó. */
export function CheckInPanel() {
  const [month, setMonth] = useState(() => businessMonth());
  const [picked, setPicked] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<AttendanceSlot | null>(null);
  const [viewing, setViewing] = useState<AttendanceCheck | null>(null);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["attendance", "mine", month],
    queryFn: () => fetchMyAttendance(month),
    placeholderData: keepPreviousData,
  });

  if (isPending) return <SkeletonCard lines={4} />;
  if (isError) return <ErrorState what="lượt chấm công" onRetry={refetch} retrying={isFetching} />;

  const today = data.today || businessDay();
  const selected = picked ?? today;
  // Lúc đổi tháng, `data` còn là tháng cũ cho tới khi tải xong: chưa đúng tháng thì
  // chưa biết ngày đang chọn đã chấm những lượt nào, không cho bấm.
  const monthLoaded = data.month === selected.slice(0, 7);
  const dayChecks = data.checks.filter((c) => c.workDate === selected);
  // Bốn lượt đi đúng thứ tự: chỉ lượt đầu tiên chưa chấm mới bấm được.
  const nextSlot = ATTENDANCE_SLOTS.find((s) => !dayChecks.some((c) => c.slot === s.key))?.key;
  const checkedDays = [...new Set(data.checks.map((c) => c.workDate))].map(toDate);

  return (
    <SectionCard title="Chấm công của tôi" icon={<CalendarCheck size={17} />} meta={formatDate(selected)}>
      <div className={styles.layout}>
        <div className={styles.slotsWrap}>
          <ul className={styles.slots}>
            {ATTENDANCE_SLOTS.map((s) => {
              const check = dayChecks.find((c) => c.slot === s.key);
              if (check) {
                const time = clockNowVn(new Date(check.checkedAt)).slice(0, 5);
                return (
                  <li key={s.key} className={clsx(styles.slot, styles.slotPhoto)}>
                    <button
                      type="button"
                      className={styles.photoTile}
                      aria-label={`Xem lượt ${s.label} lúc ${time}`}
                      onClick={() => setViewing(check)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đi qua /api/images có kiểm phiên, next/image không tối ưu được */}
                      <img src={check.photoUrl} alt="" className={styles.photo} />
                      <span className={styles.overlayTime}>{time}</span>
                      {check.place && <span className={styles.overlayPlace}>{check.place}</span>}
                    </button>
                  </li>
                );
              }
              if (selected === today && monthLoaded && s.key === nextSlot) {
                // Máy tính bấm nút cam; điện thoại bấm cả ô, ô chỉ có icon camera ở giữa.
                return (
                  <li key={s.key} className={clsx(styles.slot, styles.slotNext)}>
                    <span className={styles.label}>{s.label}</span>
                    <Button block className={styles.captureButton} onClick={() => setCapturing(s.key)}>
                      <Camera size={16} aria-hidden />
                      Chấm công
                    </Button>
                    <button
                      type="button"
                      className={styles.captureTile}
                      aria-label={`Chấm công ${s.label}`}
                      onClick={() => setCapturing(s.key)}
                    >
                      <Camera size={28} aria-hidden />
                    </button>
                  </li>
                );
              }
              return (
                <li key={s.key} className={styles.slot}>
                  <span className={styles.label}>{s.label}</span>
                  <span className={styles.missing}>Chưa chấm</span>
                </li>
              );
            })}
          </ul>
        </div>

        <DayPicker
          mode="single"
          locale={vi}
          required
          selected={toDate(selected)}
          onSelect={(d) => setPicked(toIso(d))}
          month={toDate(`${month}-01`)}
          onMonthChange={(d) => {
            // Ngày đang chọn đi theo tháng đang xem, không thì 4 lượt hiện ngày của tháng khác.
            const next = toIso(d).slice(0, 7);
            setMonth(next);
            setPicked(next === today.slice(0, 7) ? null : `${next}-01`);
          }}
          endMonth={toDate(today)}
          disabled={{ after: toDate(today) }}
          modifiers={{ checked: checkedDays }}
          modifiersClassNames={{ checked: styles.checked }}
          className={styles.calendar}
        />
      </div>

      {capturing && <CameraCheckIn slot={capturing} onClose={() => setCapturing(null)} />}
      {viewing && (
        <CheckDetailDialog
          key={viewing.id}
          check={viewing}
          title={slotLabel(viewing.slot)}
          onClose={() => setViewing(null)}
        />
      )}
    </SectionCard>
  );
}

"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { vi } from "date-fns/locale";
import { Camera, CalendarCheck, MapPin } from "lucide-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import {
  addMyCheck,
  ATTENDANCE_SLOTS,
  CHECK_IN_SLOT,
  createAttendanceCheck,
  fetchMyAttendance,
  slotLabel,
  type AttendanceCheck,
  type AttendanceMode,
  type AttendanceSlot,
} from "@/lib/api/attendance";
import { businessDay, businessMonth, clockNowVn, formatDate } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { CameraCheckIn } from "./CameraCheckIn";
import { CheckDetailDialog } from "./CheckDetailDialog";
import styles from "./CheckInPanel.module.scss";

/** Ngày lịch của trình duyệt ↔ chuỗi `YYYY-MM-DD`, đọc theo giờ địa phương như DayPicker. */
const toDate = (iso: string) => new Date(`${iso}T00:00:00`);
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Mã 1 là bị từ chối quyền; mã 2 và 3 là chưa bắt được tín hiệu hoặc quá 20 giây. */
const locationError = (code?: number) =>
  code === 1
    ? "Không lấy được vị trí. Bạn bật vị trí cho trình duyệt rồi thử lại."
    : "Chưa lấy được vị trí. Bạn thử lại.";

const currentPosition = () =>
  new Promise<{ latitude: number; longitude: number; accuracy: number }>((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error(locationError(1)));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (e) => reject(new Error(locationError(e.code))),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });

/**
 * Lịch tháng của chính mình: ngày có chấm công tô xanh, bấm ngày nào thì hiện
 * các lượt của ngày đó. `slots` là 4 lượt có ảnh của nhân viên Điểm ATM,
 * `daily` là 1 lượt điểm danh không ảnh của Phòng An Sinh.
 */
export function CheckInPanel({ mode }: { mode: AttendanceMode }) {
  const [month, setMonth] = useState(() => businessMonth());
  const [picked, setPicked] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<AttendanceSlot | null>(null);
  const [viewing, setViewing] = useState<AttendanceCheck | null>(null);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["attendance", "mine", month],
    queryFn: () => fetchMyAttendance(month),
    placeholderData: keepPreviousData,
  });

  const queryClient = useQueryClient();
  const checkIn = useMutation({
    mutationFn: async (workDate: string | undefined) =>
      createAttendanceCheck({ slot: CHECK_IN_SLOT.key, photoUrl: "", workDate, ...(await currentPosition()) }),
    onSuccess: (check, workDate) => {
      addMyCheck(queryClient, check);
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      const time = clockNowVn(new Date(check.checkedAt)).slice(0, 5);
      toast.ok(`Đã điểm danh${workDate ? ` ngày ${formatDate(workDate)}` : ""} lúc ${time}`);
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.fail(errorMessage(e, "Không lưu được lượt điểm danh."));
    },
  });

  if (isPending) return <SkeletonCard lines={4} />;
  if (isError) return <ErrorState what="lượt chấm công" onRetry={refetch} retrying={isFetching} />;

  const today = data.today || businessDay();
  const selected = picked ?? today;
  // Lúc đổi tháng, `data` còn là tháng cũ cho tới khi tải xong: chưa đúng tháng thì
  // chưa biết ngày đang chọn đã chấm những lượt nào, không cho bấm.
  const monthLoaded = data.month === selected.slice(0, 7);
  const dayChecks = data.checks.filter((c) => c.workDate === selected);
  const daily = mode === "daily";
  const slots = daily ? [CHECK_IN_SLOT] : ATTENDANCE_SLOTS;
  // Các lượt đi đúng thứ tự: chỉ lượt đầu tiên chưa chấm mới bấm được.
  const nextSlot = slots.find((s) => !dayChecks.some((c) => c.slot === s.key))?.key;
  const checkedDays = [...new Set(data.checks.map((c) => c.workDate))].map(toDate);
  // Chấm bù chỉ mở khi máy chủ cho (spec 4.2), và chỉ cho ngày đã qua trong tháng đang chạy.
  const backfillDay = data.backfill && selected.slice(0, 7) === today.slice(0, 7) && selected < today;
  const workDate = backfillDay ? selected : undefined;

  return (
    <SectionCard title="Chấm công của tôi" icon={<CalendarCheck size={17} />} meta={formatDate(selected)}>
      <div className={styles.layout}>
        <div className={styles.slotsWrap}>
          <ul className={clsx(styles.slots, daily && styles.daily)}>
            {slots.map((s) => {
              const check = dayChecks.find((c) => c.slot === s.key);
              if (check && !check.photoUrl) {
                const time = clockNowVn(new Date(check.checkedAt)).slice(0, 5);
                return (
                  <li key={s.key} className={clsx(styles.slot, styles.slotDone)}>
                    <button
                      type="button"
                      className={styles.doneTile}
                      aria-label={`Xem lượt ${s.label} lúc ${time}`}
                      onClick={() => setViewing(check)}
                    >
                      <span className={styles.label}>{s.label}</span>
                      <span className={styles.doneTime}>{time}</span>
                      {check.place && (
                        <span className={styles.donePlace}>
                          <MapPin size={13} aria-hidden />
                          {check.place}
                        </span>
                      )}
                    </button>
                  </li>
                );
              }
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
                      <img src={check.photoUrl ?? undefined} alt="" className={styles.photo} />
                      <span className={styles.overlayTime}>{time}</span>
                      {check.place && <span className={styles.overlayPlace}>{check.place}</span>}
                    </button>
                  </li>
                );
              }
              if (daily && (selected === today || backfillDay) && monthLoaded && s.key === nextSlot) {
                return (
                  <li key={s.key} className={clsx(styles.slot, styles.slotNext)}>
                    <span className={styles.label}>{s.label}</span>
                    <Button block large disabled={checkIn.isPending} onClick={() => checkIn.mutate(workDate)}>
                      <MapPin size={16} aria-hidden />
                      {checkIn.isPending ? "Đang lấy vị trí…" : "Điểm danh"}
                    </Button>
                  </li>
                );
              }
              if ((selected === today || backfillDay) && monthLoaded && s.key === nextSlot) {
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
                  {monthLoaded && <span className={styles.missing}>{daily ? "Chưa điểm danh" : "Chưa chấm"}</span>}
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

      {capturing && <CameraCheckIn slot={capturing} workDate={workDate} onClose={() => setCapturing(null)} />}
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

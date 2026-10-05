"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CalendarCheck, MapPin } from "lucide-react";
import { useState } from "react";
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
import { AttendanceCalendar } from "./AttendanceCalendar";
import { CameraCheckIn } from "./CameraCheckIn";
import { CheckDetailDialog } from "./CheckDetailDialog";
import { SlotTile, type SlotAction } from "./SlotTile";
import styles from "./CheckInPanel.module.scss";

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
  const checkedDays = [...new Set(data.checks.map((c) => c.workDate))];
  // Chấm bù chỉ mở khi máy chủ cho (spec 4.2), và chỉ cho ngày đã qua trong tháng đang chạy.
  const backfillDay = data.backfill && selected.slice(0, 7) === today.slice(0, 7) && selected < today;
  const workDate = backfillDay ? selected : undefined;

  return (
    <SectionCard title="Chấm công của tôi" icon={<CalendarCheck size={17} />} meta={formatDate(selected)}>
      <div className={styles.layout}>
        <div className={styles.slotsWrap}>
          <ul className={styles.slots}>
            {slots.map((s) => {
              const canAct = (selected === today || backfillDay) && monthLoaded && s.key === nextSlot;
              const action: SlotAction | undefined = !canAct
                ? undefined
                : daily
                  ? {
                      icon: MapPin,
                      text: checkIn.isPending ? "Đang lấy vị trí…" : "Điểm danh",
                      ariaLabel: "Điểm danh",
                      disabled: checkIn.isPending,
                      onClick: () => checkIn.mutate(workDate),
                    }
                  : {
                      icon: Camera,
                      text: "Chấm công",
                      ariaLabel: `Chấm công ${s.label}`,
                      onClick: () => setCapturing(s.key),
                    };
              return (
                <SlotTile
                  key={s.key}
                  label={s.label}
                  check={dayChecks.find((c) => c.slot === s.key)}
                  onView={setViewing}
                  action={action}
                  missingText={monthLoaded ? (daily ? "Chưa điểm danh" : "Chưa chấm") : null}
                />
              );
            })}
          </ul>
        </div>

        <AttendanceCalendar
          selected={selected}
          month={month}
          today={today}
          checkedDays={checkedDays}
          onSelect={setPicked}
          onMonthChange={(next) => {
            // Ngày đang chọn đi theo tháng đang xem, không thì 4 lượt hiện ngày của tháng khác.
            setMonth(next);
            setPicked(next === today.slice(0, 7) ? null : `${next}-01`);
          }}
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

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DateField } from "@/components/ui/DateField";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  ATTENDANCE_SLOTS,
  CHECK_IN_SLOT,
  fetchAttendanceDay,
  slotLabel,
  type AttendanceCheck,
  type AttendanceDayRow,
  type AttendanceMode,
} from "@/lib/api/attendance";
import { businessDay, clockNowVn, formatDate } from "@/lib/format";
import { isRealIsoDate } from "@/lib/types";
import { CheckDetailDialog } from "./CheckDetailDialog";
import styles from "./AttendanceDayTable.module.scss";

type Viewing = { row: AttendanceDayRow; check: AttendanceCheck };

/**
 * Bảng một ngày cho người có quyền xem, tách 2 tab: ATM là 4 lượt có ảnh của
 * nhân viên Điểm ATM, Hành chính là lượt điểm danh của người Phòng An Sinh.
 */
export function AttendanceDayTable() {
  const today = businessDay();
  const [workDate, setWorkDate] = useState(today);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [picked, setPicked] = useState<AttendanceMode | null>(null);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["attendance", "day", workDate],
    queryFn: () => fetchAttendanceDay(workDate),
    enabled: isRealIsoDate(workDate),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const atmRows = rows.filter((r) => r.mode === "slots");
  const dailyRows = rows.filter((r) => r.mode === "daily");
  // Người chỉ xem được một nhóm thì mở thẳng tab của nhóm đó.
  const group = picked ?? (atmRows.length === 0 && dailyRows.length > 0 ? "daily" : "slots");
  const slotColumns = group === "daily" ? [CHECK_IN_SLOT] : ATTENDANCE_SLOTS;

  const columns: RankColumn<AttendanceDayRow>[] = [
    {
      key: "fullName",
      label: "Nhân viên",
      sortText: (r) => r.fullName,
      render: (r) => (
        <Link href={`/users/${r.userId}`} className={styles.nameLink}>
          {r.fullName}
        </Link>
      ),
    },
    { key: "staffCode", label: "Mã nhân viên", render: (r) => r.staffCode ?? "" },
    ...slotColumns.map(
      (s): RankColumn<AttendanceDayRow> => ({
        key: s.key,
        label: s.label,
        render: (r) => {
          const check = r.checks.find((c) => c.slot === s.key);
          if (!check)
            return <span className={styles.missing}>{group === "daily" ? "Chưa điểm danh" : "Chưa chấm"}</span>;
          const time = clockNowVn(new Date(check.checkedAt)).slice(0, 5);
          return (
            <button
              type="button"
              className={styles.time}
              aria-label={`Xem lượt ${s.label} của ${r.fullName} lúc ${time}`}
              onClick={() => setViewing({ row: r, check })}
            >
              {time}
            </button>
          );
        },
      }),
    ),
  ];

  return (
    <SectionCard title="Bảng chấm công" icon={<Users size={17} />} meta={data ? formatDate(data.workDate) : undefined}>
      <div className={styles.date}>
        <DateField label="Ngày" value={workDate} max={today} onChange={setWorkDate} />
      </div>

      {isPending && <SkeletonTable rows={8} columns={6} />}
      {isError && <ErrorState what="bảng chấm công" onRetry={refetch} retrying={isFetching} />}
      {data && !isError && (
        <>
          <SegmentedTabs
            label="Loại chấm công"
            value={group}
            onChange={(v) => setPicked(v === "daily" ? "daily" : "slots")}
            options={[
              { value: "slots", label: "ATM", count: atmRows.length },
              { value: "daily", label: "Hành chính", count: dailyRows.length },
            ]}
          />
          <RankTable
            key={group}
            rows={group === "daily" ? dailyRows : atmRows}
            columns={columns}
            rowKey={(r) => r.userId}
            defaultSort="fullName"
            caption={group === "daily" ? "Điểm danh hành chính trong ngày" : "Chấm công ATM trong ngày"}
            emptyText={
              group === "daily"
                ? "Không có người Phòng An Sinh nào trong phạm vi bạn xem."
                : "Không có nhân viên Điểm ATM nào trong phạm vi bạn xem."
            }
          />
        </>
      )}

      {viewing && (
        <CheckDetailDialog
          key={viewing.check.id}
          check={viewing.check}
          title={`${viewing.row.fullName} - ${slotLabel(viewing.check.slot)}`}
          onClose={() => setViewing(null)}
        />
      )}
    </SectionCard>
  );
}

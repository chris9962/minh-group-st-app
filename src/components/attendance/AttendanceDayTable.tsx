"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DateField } from "@/components/ui/DateField";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  ATTENDANCE_SLOTS,
  fetchAttendanceDay,
  slotLabel,
  type AttendanceCheck,
  type AttendanceDayRow,
} from "@/lib/api/attendance";
import { businessDay, clockNowVn, formatDate } from "@/lib/format";
import { isRealIsoDate } from "@/lib/types";
import { CheckDetailDialog } from "./CheckDetailDialog";
import styles from "./AttendanceDayTable.module.scss";

type Viewing = { row: AttendanceDayRow; check: AttendanceCheck };

/** Bảng một ngày cho người có quyền xem: mỗi nhân viên Điểm ATM một dòng, mỗi lượt một cột. */
export function AttendanceDayTable() {
  const today = businessDay();
  const [workDate, setWorkDate] = useState(today);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["attendance", "day", workDate],
    queryFn: () => fetchAttendanceDay(workDate),
    enabled: isRealIsoDate(workDate),
    placeholderData: keepPreviousData,
  });

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
    ...ATTENDANCE_SLOTS.map(
      (s): RankColumn<AttendanceDayRow> => ({
        key: s.key,
        label: s.label,
        render: (r) => {
          const check = r.checks.find((c) => c.slot === s.key);
          if (!check) return <span className={styles.missing}>Chưa chấm</span>;
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
        <RankTable
          rows={data.rows}
          columns={columns}
          rowKey={(r) => r.userId}
          defaultSort="fullName"
          caption="Chấm công của nhân viên Điểm ATM trong ngày"
          emptyText="Không có nhân viên Điểm ATM nào trong phạm vi bạn xem."
        />
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

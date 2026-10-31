"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
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
  type AttendanceDayGroup,
  type AttendanceDayRow,
} from "@/lib/api/attendance";
import { businessDay, clockNowVn, formatDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { useSession } from "@/store/session";
import { CheckDetailDialog } from "./CheckDetailDialog";
import { RecordAttendanceDialog } from "./RecordAttendanceDialog";
import styles from "./AttendanceDayTable.module.scss";

type Viewing = { row: AttendanceDayRow; check: AttendanceCheck };

const clockOf = (iso: string) => clockNowVn(new Date(iso)).slice(0, 5);

const groupKey = (g: AttendanceDayGroup) => g.departmentId ?? "";
const groupLabel = (g: AttendanceDayGroup) => g.departmentName || "Không có phòng";

/**
 * Bảng một ngày cho người có quyền xem, một tab mỗi phòng có chấm công. Cột
 * theo cách chấm của phòng đó.
 */
export function AttendanceDayTable() {
  const today = businessDay();
  const [workDate, setWorkDate] = useState(today);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [recording, setRecording] = useState<AttendanceDayRow | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const canRecord = can(useSession((s) => s.user), "attendance", "record-attendance");
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["attendance", "day", workDate],
    queryFn: () => fetchAttendanceDay(workDate),
    enabled: isRealIsoDate(workDate),
    placeholderData: keepPreviousData,
  });

  const groups = data?.groups ?? [];
  const current = groups.find((g) => groupKey(g) === picked) ?? groups[0] ?? null;
  const daily = current?.mode === "daily";
  // Phòng đổi cách chấm giữa tháng: ngày cũ còn lượt của cách cũ, phải có cột để xem.
  const hasSlot = (key: string) => current?.rows.some((r) => r.checks.some((c) => c.slot === key)) ?? false;
  const modeColumns = daily ? [CHECK_IN_SLOT] : ATTENDANCE_SLOTS;
  const slotColumns = [
    ...modeColumns,
    ...[...ATTENDANCE_SLOTS, CHECK_IN_SLOT].filter((s) => !modeColumns.some((m) => m.key === s.key) && hasSlot(s.key)),
  ];

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
            return (
              <span className={styles.missing}>{s.key === CHECK_IN_SLOT.key ? "Chưa điểm danh" : "Chưa chấm"}</span>
            );
          const time = check.checkedOutAt
            ? `${clockOf(check.checkedAt)} - ${clockOf(check.checkedOutAt)}`
            : clockOf(check.checkedAt);
          return (
            <>
              <button
                type="button"
                className={styles.time}
                aria-label={`Xem lượt ${s.label} của ${r.fullName} lúc ${time}`}
                onClick={() => setViewing({ row: r, check })}
              >
                {time}
              </button>
              {check.recordedByName && <span className={styles.recorded}>Ghi công</span>}
            </>
          );
        },
      }),
    ),
    ...(canRecord && current
      ? [
          {
            key: "record",
            label: "Ghi công",
            render: (r: AttendanceDayRow) =>
              modeColumns.every((s) => r.checks.some((c) => c.slot === s.key)) ? null : (
                <Button variant="secondary" onClick={() => setRecording(r)} aria-label={`Ghi công cho ${r.fullName}`}>
                  Ghi công
                </Button>
              ),
          } satisfies RankColumn<AttendanceDayRow>,
        ]
      : []),
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
          {groups.length > 1 && current && (
            <SegmentedTabs
              label="Phòng"
              value={groupKey(current)}
              onChange={setPicked}
              options={groups.map((g) => ({ value: groupKey(g), label: groupLabel(g), count: g.rows.length }))}
            />
          )}
          <RankTable
            key={current ? groupKey(current) : "none"}
            rows={current?.rows ?? []}
            columns={columns}
            rowKey={(r) => r.userId}
            defaultSort="fullName"
            caption={current ? `Chấm công ${groupLabel(current)} trong ngày` : "Chấm công trong ngày"}
            emptyText="Không có phòng nào chấm công trong phạm vi bạn xem."
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

      {recording && current && (
        <RecordAttendanceDialog
          key={`${recording.userId}:${workDate}`}
          row={recording}
          mode={current.mode}
          workDate={workDate}
          onClose={() => setRecording(null)}
        />
      )}
    </SectionCard>
  );
}

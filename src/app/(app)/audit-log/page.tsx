"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { History } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { fetchAuditLog, type AuditLogEntry } from "@/lib/api/auditLog";
import { fetchStaffOptions } from "@/lib/api/staff";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { ACTION_LABEL, Action, MODULE_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const formatDateTime = (value: string): string => {
  const d = new Date(value);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

/**
 * P-93 · Nhật ký truy vết — ai · làm gì · lúc nào · trên bản ghi nào.
 *
 * Chỉ GĐ · QTHT xem được — gate bằng `manage-org`, không phải `view-detail`,
 * vì Kế toán tổng hợp cũng có `view-detail` qua wildcard `*` dù không nên
 * thấy nhật ký truy vết.
 */
export default function AuditLogPage() {
  const user = useSession((s) => s.user);
  const canView = can(user, "system", "manage-org");

  const [staffId, setStaffId] = useState("");
  const [action, setAction] = useState<Action | "">("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [page, setPage] = useState(0);
  // Chỉ sắp theo thời điểm, và chỉ đổi được chiều — `AUDIT_LOG_SORT` có đúng
  // một khoá vì bảng này chỉ có chỉ mục theo `at`.
  const [dir, setDir] = useState<SortDir>("desc");

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  /** Đổi bộ lọc thì về trang đầu — giữ trang 5 của kết quả cũ là hiện khúc rỗng. */
  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["audit-log", staffId, action, from, to, page, dir],
    queryFn: () => fetchAuditLog({ staffId, action, from, to, page, sort: "at", dir }),
    enabled: canView,
    placeholderData: keepPreviousData,
  });

  /**
   * Ô lọc "Người" đọc TRỌN danh sách nhân viên, không gom từ các dòng đang hiện.
   *
   * Gom từ dòng thì ô chọn chỉ có những người tình cờ nằm ở trang đang xem —
   * lọc theo người thứ 16 trở đi là không chọn được. Hỏng thì để rỗng chứ không
   * chặn cả màn: người có `manage-org` mà thiếu `staff:view-detail` vẫn phải đọc
   * được nhật ký, chỉ là không lọc theo tên.
   */
  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "options", "all"],
    queryFn: () => fetchStaffOptions({ status: "all" }),
    enabled: canView,
    retry: false,
    staleTime: Infinity,
  });

  const staffOptions = useMemo(
    () => staff.map((s) => ({ value: s.id, label: s.fullName })),
    [staff],
  );

  const activeCount = (staffId ? 1 : 0) + (action ? 1 : 0) + (from && to ? 1 : 0);
  const filtering = activeCount > 0;

  const columns = useMemo<RankColumn<AuditLogEntry>[]>(
    () => [
      {
        key: "at",
        label: "Lúc",
        sortable: true,
        render: (r) => <span className="tabular-nums">{formatDateTime(r.at)}</span>,
      },
      { key: "actorName", label: "Người", render: (r) => r.actorName },
      {
        key: "action",
        label: "Hành động",
        render: (r) => `${MODULE_LABEL[r.module]} · ${ACTION_LABEL[r.action]}`,
      },
      { key: "targetLabel", label: "Đối tượng", render: (r) => r.targetLabel },
    ],
    [],
  );

  if (!canView) {
    return (
      <>
        <TopBar title="Nhật ký truy vết" />
        <main className={styles.body}>
          <p className="text-muted">Bạn không có quyền xem trang này.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="Nhật ký truy vết">
        <FilterButton
          activeCount={activeCount}
          onClear={() =>
            refine(() => {
              setStaffId("");
              setAction("");
              setRange(undefined);
            })
          }
        >
          <Select
            label="Người"
            value={staffId}
            onChange={(v) => refine(() => setStaffId(v))}
            options={[{ value: "", label: "Tất cả mọi người" }, ...staffOptions]}
          />
          <Select
            label="Hành động"
            value={action}
            onChange={(v) => refine(() => setAction(v as Action | ""))}
            options={[
              { value: "", label: "Tất cả hành động" },
              ...Action.options.map((a) => ({ value: a, label: ACTION_LABEL[a] })),
            ]}
          />
          <DateRangePicker value={range} onChange={(v) => refine(() => setRange(v))} />
        </FilterButton>
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(staffId
              ? [
                  {
                    label: `Người: ${staffOptions.find((s) => s.value === staffId)?.label ?? ""}`,
                    onRemove: () => refine(() => setStaffId("")),
                  },
                ]
              : []),
            ...(action
              ? [{ label: `Hành động: ${ACTION_LABEL[action]}`, onRemove: () => refine(() => setAction("")) }]
              : []),
            ...(from && to
              ? [
                  {
                    label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`,
                    onRemove: () => refine(() => setRange(undefined)),
                  },
                ]
              : []),
          ]}
        />

        <p className={styles.note}>
          Ghi lại ai xem/sửa gì, lúc nào — vì mọi nhân viên xem được CCCD và địa
          chỉ của mọi khách trong công ty. Đây là bằng chứng bảo vệ, không phải
          giám sát: số liệu lệch thì tra được ai đã sửa.
        </p>

        {isPending && <SkeletonTable rows={10} columns={4} />}
        {isError && (
          <ErrorState what="nhật ký truy vết" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <SectionCard title="Nhật ký" icon={<History size={17} />} meta={`${data.total} dòng`}>
            <RankTable
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort="at"
              caption="Nhật ký truy vết theo thời gian gần nhất"
              emptyText={
                filtering
                  ? "Không có hành động nào khớp bộ lọc."
                  : "Chưa có hành động nào được ghi lại."
              }
              server={{
                sort: "at",
                dir,
                page,
                total: data.total,
                pageSize: PAGE_SIZE,
                onSortChange: (_sort, nextDir) => {
                  setDir(nextDir);
                  setPage(0);
                },
                onPageChange: setPage,
              }}
            />
          </SectionCard>
        )}
      </main>
    </>
  );
}

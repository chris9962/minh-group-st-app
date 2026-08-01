"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { History } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { fetchAuditLog, type AuditLogEntry } from "@/lib/api/auditLog";
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

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const { data, isPending, isError } = useQuery({
    queryKey: ["audit-log", staffId, action, from, to],
    queryFn: () =>
      fetchAuditLog({
        actorId: user?.id ?? "",
        staffId,
        action,
        from,
        to,
      }),
    enabled: canView,
    placeholderData: (previous) => previous,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const staffOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.actorId, r.actorName);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const activeCount = (staffId ? 1 : 0) + (action ? 1 : 0) + (from && to ? 1 : 0);

  const columns = useMemo<RankColumn<AuditLogEntry>[]>(
    () => [
      {
        key: "at",
        label: "Lúc",
        sortBy: (r) => new Date(r.at).getTime(),
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
          onClear={() => {
            setStaffId("");
            setAction("");
            setRange(undefined);
          }}
        >
          <Select
            label="Người"
            value={staffId}
            onChange={setStaffId}
            options={[{ value: "", label: "Tất cả mọi người" }, ...staffOptions]}
          />
          <Select
            label="Hành động"
            value={action}
            onChange={(v) => setAction(v as Action | "")}
            options={[
              { value: "", label: "Tất cả hành động" },
              ...Action.options.map((a) => ({ value: a, label: ACTION_LABEL[a] })),
            ]}
          />
          <DateRangePicker value={range} onChange={setRange} />
        </FilterButton>
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(staffId
              ? [
                  {
                    label: `Người: ${staffOptions.find((s) => s.value === staffId)?.label ?? ""}`,
                    onRemove: () => setStaffId(""),
                  },
                ]
              : []),
            ...(action ? [{ label: `Hành động: ${ACTION_LABEL[action]}`, onRemove: () => setAction("") }] : []),
            ...(from && to
              ? [{ label: `Ngày: ${from} → ${to}`, onRemove: () => setRange(undefined) }]
              : []),
          ]}
        />

        <p className={styles.note}>
          Ghi lại ai xem/sửa gì, lúc nào — vì mọi nhân viên xem được CCCD và địa
          chỉ của mọi khách trong công ty. Đây là bằng chứng bảo vệ, không phải
          giám sát: số liệu lệch thì tra được ai đã sửa.
        </p>

        {isPending && <p className="text-muted">Đang tải nhật ký…</p>}
        {isError && <p className="text-muted">Không tải được nhật ký truy vết.</p>}

        {data && (
          <SectionCard title="Nhật ký" icon={<History size={17} />} meta={`${data.summary.total} dòng`}>
            {rows.length === 0 ? (
              <p className="text-muted">Chưa có hành động nào khớp bộ lọc.</p>
            ) : (
              <RankTable
                rows={rows}
                columns={columns}
                rowKey={(r) => r.id}
                defaultSort="at"
                pageSize={20}
                caption="Nhật ký truy vết theo thời gian gần nhất"
              />
            )}
          </SectionCard>
        )}
      </main>
    </>
  );
}

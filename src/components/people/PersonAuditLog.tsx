"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { fetchAuditLog, type AuditLogEntry } from "@/lib/api/auditLog";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { formatDateTime } from "@/lib/format";
import { ACTION_LABEL, MODULE_LABEL } from "@/lib/types";

/** Nhật ký hoạt động của một nhân viên. Người gọi tự kiểm `system:manage-org`. */
export function PersonAuditLog({ staffId }: { staffId: string }) {
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<SortDir>("desc");

  // Cùng dạng khoá với màn P-93 để hai màn dùng chung cache.
  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["audit-log", staffId, "", "", "", page, dir],
    queryFn: () => fetchAuditLog({ staffId, action: "", from: "", to: "", page, sort: "at", dir }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<RankColumn<AuditLogEntry>[]>(
    () => [
      {
        key: "at",
        label: "Lúc",
        sortable: true,
        render: (r) => <span className="tabular-nums">{formatDateTime(r.at)}</span>,
      },
      {
        key: "action",
        label: "Hành động",
        render: (r) => `${MODULE_LABEL[r.module]} - ${ACTION_LABEL[r.action]}`,
      },
      { key: "targetLabel", label: "Đối tượng", render: (r) => r.targetLabel },
    ],
    [],
  );

  if (isPending) return <SkeletonTable rows={10} columns={3} />;
  if (isError)
    return <ErrorState what="nhật ký hoạt động" onRetry={refetch} retrying={isFetching} />;

  return (
    <SectionCard title="Nhật ký hoạt động" icon={<History size={17} />} meta={`${data.total} dòng`}>
      <RankTable
        rows={data.rows}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort="at"
        caption="Nhật ký hoạt động của nhân viên theo thời gian gần nhất"
        emptyText="Chưa có hành động nào được ghi lại."
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
  );
}

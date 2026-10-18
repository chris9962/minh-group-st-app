"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Plus, UserMinus } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { ExcludeFromDepartmentDialog } from "@/components/staff/ExcludeFromDepartmentDialog";
import { RestoreToDepartmentDialog } from "@/components/staff/RestoreToDepartmentDialog";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { FilterChoices } from "@/components/ui/FilterChoices";
import { FilterField } from "@/components/ui/FilterField";
import { MonthPicker, monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  fetchDepartmentPoints,
  type DepartmentPointsQuery,
  type DepartmentPointsRow,
  type DepartmentPointsSort,
} from "@/lib/api/departmentPoints";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { personHref } from "@/lib/api/people";
import { formatDate, formatPoints } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import styles from "./page.module.scss";

/** P-54 · Danh sách nhân viên bị loại khỏi điểm phòng theo tháng (chốt 2026-10-18). */
export default function DepartmentPointsPage() {
  const [month, setMonth] = useState(thisMonth);
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<DepartmentPointsSort>("at");
  const [dir, setDir] = useState<SortDir>("desc");
  const [adding, setAdding] = useState(false);
  const [restoring, setRestoring] = useState<DepartmentPointsRow | null>(null);

  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const query: DepartmentPointsQuery = { month, departmentId, search: searchQuery, page, sort, dir };
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["department-points", query],
    queryFn: () => fetchDepartmentPoints(query),
    placeholderData: keepPreviousData,
  });
  const rows = data?.page.rows ?? EMPTY_PAGE.rows;
  const departments = data?.departments ?? [];
  const canEdit = data !== undefined && !data.monthClosed;

  const columns: RankColumn<DepartmentPointsRow>[] = [
    {
      key: "name",
      label: "Nhân viên",
      sortable: true,
      render: (r) => (
        <Link href={personHref(r.id, month)} className={styles.nameCell}>
          <span className={styles.nameText}>{r.fullName}</span>
          {r.staffCode && <span className={`${styles.nameCode} tabular-nums`}>{r.staffCode}</span>}
        </Link>
      ),
    },
    { key: "departmentName", label: "Đơn vị", render: (r) => r.departmentName },
    {
      key: "points",
      label: "Điểm KPI",
      sortable: true,
      render: (r) => <span className="tabular-nums">{formatPoints(r.points)}</span>,
    },
    { key: "note", label: "Lý do", render: (r) => r.note },
    {
      key: "at",
      label: "Người loại",
      sortable: true,
      render: (r) => (
        <span className={styles.byCell}>
          <span>{r.byName}</span>
          <span className={styles.byDate}>{formatDate(r.at)}</span>
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            label: "Thao tác",
            render: (r: DepartmentPointsRow) => (
              <Button variant="secondary" onClick={() => setRestoring(r)}>
                Khôi phục
              </Button>
            ),
          },
        ]
      : []),
  ];

  const departmentName = departments.find((d) => d.id === departmentId)?.name ?? "";

  return (
    <>
      <TopBar title="Loại khỏi điểm phòng">
        <SearchField
          label="Tìm nhân viên"
          placeholder="Tìm tên hoặc mã nhân viên…"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
        />
        <FilterButton
          activeCount={departmentId ? 1 : 0}
          onClear={() => refine(() => setDepartmentId(""))}
        >
          <FilterField id="month" label="Tháng">
            <MonthPicker value={month} onChange={(m) => refine(() => setMonth(m))} />
          </FilterField>
          <FilterField id="department" label="Đơn vị" count={departmentId ? 1 : 0}>
            <FilterChoices
              label="Đơn vị"
              value={departmentId}
              onChange={(v) => refine(() => setDepartmentId(v))}
              options={[
                { value: "", label: "Tất cả đơn vị" },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </FilterField>
        </FilterButton>
        {canEdit && (
          <Button aria-label="Thêm nhân viên" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Thêm nhân viên</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={
            departmentId
              ? [{ label: `Đơn vị: ${departmentName}`, onRemove: () => refine(() => setDepartmentId("")) }]
              : []
          }
        />

        {isPending && <SkeletonTable rows={6} columns={columns.length} />}
        {isError && <ErrorState what="danh sách nhân viên" onRetry={refetch} retrying={isFetching} />}

        {data && (
          <SectionCard
            title="Nhân viên bị loại"
            icon={<UserMinus size={17} />}
            meta={
              data.monthClosed
                ? `${monthLabel(data.month)} - Đã chốt lương`
                : searchQuery
                  ? `${monthLabel(data.month)} - khớp ${data.page.total}`
                  : monthLabel(data.month)
            }
          >
            <RankTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort={sort}
              caption={`Nhân viên bị loại khỏi điểm phòng ${monthLabel(data.month)}`}
              emptyText={
                searchQuery
                  ? `Không tìm thấy nhân viên nào khớp “${searchQuery}”.`
                  : departmentId
                    ? "Không có nhân viên nào khớp bộ lọc đang chọn."
                    : `Chưa có nhân viên nào bị loại khỏi điểm phòng ${monthLabel(data.month).toLowerCase()}.`
              }
              server={{
                sort,
                dir,
                page,
                total: data.page.total,
                pageSize: PAGE_SIZE,
                onSortChange: (nextSort, nextDir) => {
                  setSort(nextSort as DepartmentPointsSort);
                  setDir(nextDir);
                  setPage(0);
                },
                onPageChange: setPage,
              }}
            />
          </SectionCard>
        )}

        {adding && <ExcludeFromDepartmentDialog month={month} onClose={() => setAdding(false)} />}

        <RestoreToDepartmentDialog staff={restoring} month={month} onClose={() => setRestoring(null)} />
      </main>
    </>
  );
}

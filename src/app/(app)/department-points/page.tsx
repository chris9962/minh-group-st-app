"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { UserMinus } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import { StatusTag } from "@/components/ui/StatusTag";
import { TextArea } from "@/components/ui/TextArea";
import {
  excludeFromDepartmentPoints,
  fetchDepartmentPoints,
  includeInDepartmentPoints,
  type DepartmentPointsQuery,
  type DepartmentPointsRow,
  type DepartmentPointsSort,
} from "@/lib/api/departmentPoints";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { personHref } from "@/lib/api/people";
import { formatDate, formatPoints } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./page.module.scss";

/** P-54 · Loại nhân viên khỏi điểm phòng theo tháng (chốt 2026-10-18). */
export default function DepartmentPointsPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(thisMonth);
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<DepartmentPointsSort>("points");
  const [dir, setDir] = useState<SortDir>("asc");
  const [excluding, setExcluding] = useState<DepartmentPointsRow | null>(null);
  const [including, setIncluding] = useState<DepartmentPointsRow | null>(null);
  const [note, setNote] = useState("");

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

  const onSaved = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ["department-points"] });
    toast.ok(message);
  };

  const exclude = useMutation({
    mutationFn: (row: DepartmentPointsRow) => excludeFromDepartmentPoints(row.id, { month, note }),
    onSuccess: (_result, row) => {
      onSaved(`Đã loại ${row.fullName} khỏi điểm phòng`);
      setExcluding(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không loại được nhân viên này. Thử lại.")),
  });

  const include = useMutation({
    mutationFn: (row: DepartmentPointsRow) => includeInDepartmentPoints(row.id, month),
    onSuccess: (_result, row) => {
      onSaved(`Đã tính lại ${row.fullName} vào điểm phòng`);
      setIncluding(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không tính lại được nhân viên này. Thử lại.")),
  });

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
    {
      key: "excluded",
      label: "Điểm phòng",
      sortable: true,
      render: (r) =>
        r.exclusion ? (
          <StatusTag tone="cancelled">Không tính</StatusTag>
        ) : (
          <StatusTag ok>Tính</StatusTag>
        ),
    },
    {
      key: "note",
      label: "Lý do",
      render: (r) =>
        r.exclusion ? (
          <span className={styles.note}>
            {r.exclusion.note && <span>{r.exclusion.note}</span>}
            <span className={styles.noteBy}>
              {r.exclusion.byName} - {formatDate(r.exclusion.at)}
            </span>
          </span>
        ) : null,
    },
    ...(data?.monthClosed
      ? []
      : [
          {
            key: "actions",
            label: "Thao tác",
            render: (r: DepartmentPointsRow) =>
              r.exclusion ? (
                <Button variant="secondary" onClick={() => setIncluding(r)}>
                  Tính lại
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNote("");
                    setExcluding(r);
                  }}
                >
                  Loại
                </Button>
              ),
          },
        ]),
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
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={
            departmentId
              ? [{ label: `Đơn vị: ${departmentName}`, onRemove: () => refine(() => setDepartmentId("")) }]
              : []
          }
        />

        {isPending && <SkeletonTable rows={8} columns={columns.length} />}
        {isError && <ErrorState what="danh sách nhân viên" onRetry={refetch} retrying={isFetching} />}

        {data && (
          <SectionCard
            title="Nhân viên"
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
              caption={`Nhân viên và điểm phòng ${monthLabel(data.month)}`}
              emptyText={
                searchQuery
                  ? `Không tìm thấy nhân viên nào khớp “${searchQuery}”.`
                  : departmentId
                    ? "Không có nhân viên nào khớp bộ lọc đang chọn."
                    : "Chưa có nhân viên nào."
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

        <ConfirmDialog
          open={excluding !== null}
          title="Loại khỏi điểm phòng"
          confirmLabel="Loại"
          pending={exclude.isPending}
          onConfirm={() => excluding && exclude.mutate(excluding)}
          onClose={() => setExcluding(null)}
        >
          <p className={styles.dialogText}>
            Bạn muốn loại <strong>{excluding?.fullName}</strong> khỏi điểm phòng{" "}
            {monthLabel(month).toLowerCase()}?
          </p>
          <TextArea
            label="Lý do"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </ConfirmDialog>

        <ConfirmDialog
          open={including !== null}
          title="Tính lại điểm phòng"
          confirmLabel="Tính lại"
          pending={include.isPending}
          onConfirm={() => including && include.mutate(including)}
          onClose={() => setIncluding(null)}
        >
          Bạn muốn tính lại <strong>{including?.fullName}</strong> vào điểm phòng{" "}
          {monthLabel(month).toLowerCase()}?
        </ConfirmDialog>
      </main>
    </>
  );
}

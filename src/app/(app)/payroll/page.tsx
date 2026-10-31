"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Wallet } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { SalaryAdjustmentsDialog } from "@/components/payroll/SalaryAdjustmentsDialog";
import { SalaryBreakdownDialog } from "@/components/payroll/SalaryBreakdownButton";
import { SalaryAdjustmentCell, SalaryAmountButton } from "@/components/payroll/SalaryCells";
import { SalaryClosingControl } from "@/components/payroll/SalaryClosingControl";
import { exportSalaryWorkbook, salaryExportColumns } from "@/components/payroll/salaryExcel";
import { Button } from "@/components/ui/Button";
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
import { fetchDepartments } from "@/lib/api/departments";
import { fetchSalaryExport } from "@/lib/api/exports";
import { PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { personHref } from "@/lib/api/people";
import {
  SALARY_ADJUSTMENT_ADD_LABEL,
  SALARY_ADJUSTMENT_LABEL,
  type SalaryAdjustmentKind,
} from "@/lib/api/salaryAdjustments";
import { fetchStaff, type StaffQuery, type StaffRow, type StaffSort } from "@/lib/api/staff";
import { formatVnd } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { availableScopes, can, scopeFor, visibleDepartmentIds } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const STATUS_FILTERS: { value: StaffQuery["status"]; label: string }[] = [
  { value: "active", label: "Đang hoạt động" },
  { value: "locked", label: "Đã khoá" },
  { value: "all", label: "Tất cả trạng thái" },
];

/** Lương từng người trong tháng: lương theo điểm, thưởng, trừ, ứng trước và lương cuối cùng. */
export default function PayrollPage() {
  const user = useSession((s) => s.user);
  // Cùng phạm vi với màn Nhân sự: máy chủ kẹp danh sách theo `staff:view-detail`.
  const scopes = availableScopes(user, "staff", "view-detail");
  const scope: Scope = scopes.at(-1) ?? "own";

  const [month, setMonth] = useState(thisMonth);
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState<StaffQuery["status"]>("active");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<StaffSort>("name");
  const [dir, setDir] = useState<SortDir>("asc");
  const [adjusting, setAdjusting] = useState<{
    row: StaffRow;
    kind: SalaryAdjustmentKind;
    mode: "list" | "add";
  } | null>(null);
  const [finalOf, setFinalOf] = useState<StaffRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });
  const departmentOptions = useMemo(() => {
    const visible = visibleDepartmentIds(user, scope);
    return visible === null ? departments : departments.filter((d) => visible.includes(d.id));
  }, [departments, scope, user]);

  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const query: StaffQuery = {
    scope,
    departmentId,
    search: searchQuery,
    summaryMonth: month,
    from: "",
    to: "",
    status,
    roles: [],
    page,
    sort,
    dir,
  };
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["staff", query],
    queryFn: () => fetchStaff(query),
    placeholderData: keepPreviousData,
  });

  const canClose = can(user, "system", "close-salary");
  // Cùng điều kiện với route báo cáo Lương: file có lương của mọi phòng kinh doanh.
  const canExport = scopeFor(user, "staff", "export") === "company";

  const exportFile = async () => {
    setExporting(true);
    try {
      const columns = salaryExportColumns().filter((c) => c.defaultOn);
      const count = await exportSalaryWorkbook(month, await fetchSalaryExport(month), columns);
      toast.ok(`Đã xuất ${count.toLocaleString("vi-VN")} dòng`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };
  const editable = canClose && !data?.monthClosed;

  const adjustmentColumn = (kind: SalaryAdjustmentKind): RankColumn<StaffRow> => ({
    key: kind,
    label: SALARY_ADJUSTMENT_LABEL[kind],
    render: (r) => (
      <SalaryAdjustmentCell
        amount={r.salaryAdjustments[kind]}
        label={`${SALARY_ADJUSTMENT_LABEL[kind]} của ${r.fullName}`}
        addLabel={`${SALARY_ADJUSTMENT_ADD_LABEL[kind]} cho ${r.fullName}`}
        onOpen={() => setAdjusting({ row: r, kind, mode: "list" })}
        onAdd={editable ? () => setAdjusting({ row: r, kind, mode: "add" }) : undefined}
      />
    ),
  });

  const columns: RankColumn<StaffRow>[] = [
    {
      key: "name",
      label: "Nhân viên",
      sortable: true,
      render: (r) => (
        <Link href={personHref(r.id, month)} className={styles.nameLink}>
          {r.fullName}
          {r.staffCode && <span className={`${styles.nameCode} tabular-nums`}>{r.staffCode}</span>}
        </Link>
      ),
    },
    { key: "departmentName", label: "Đơn vị", render: (r) => r.monthDepartmentName || "—" },
    {
      key: "salary",
      label: "Lương theo điểm",
      render: (r) => <span className="tabular-nums">{formatVnd(r.salaryBreakdown.pointsAmount)}</span>,
    },
    adjustmentColumn("bonus"),
    adjustmentColumn("deduction"),
    adjustmentColumn("advance"),
    {
      key: "finalSalary",
      label: "Lương cuối cùng",
      render: (r) => (
        <SalaryAmountButton
          amount={r.salary}
          label={`Lương cuối cùng của ${r.fullName}`}
          onClick={() => setFinalOf(r)}
        />
      ),
    },
  ];

  return (
    <>
      <TopBar title="Lương">
        <SearchField
          label="Tìm nhân viên"
          placeholder="Tìm tên, tên đăng nhập, đơn vị…"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
        />
        <FilterButton
          activeCount={(departmentId ? 1 : 0) + (status !== "active" ? 1 : 0)}
          onClear={() =>
            refine(() => {
              setDepartmentId("");
              setStatus("active");
            })
          }
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
                ...departmentOptions.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </FilterField>
          <FilterField id="status" label="Trạng thái" count={status !== "active" ? 1 : 0}>
            <FilterChoices
              label="Trạng thái tài khoản"
              value={status}
              onChange={(v) => refine(() => setStatus(v as StaffQuery["status"]))}
              options={STATUS_FILTERS}
            />
          </FilterField>
        </FilterButton>
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(departmentId
              ? [
                  {
                    label: `Đơn vị: ${departments.find((d) => d.id === departmentId)?.name ?? departmentId}`,
                    onRemove: () => refine(() => setDepartmentId("")),
                  },
                ]
              : []),
            ...(status !== "active"
              ? [
                  {
                    label: `Trạng thái: ${STATUS_FILTERS.find((x) => x.value === status)?.label}`,
                    onRemove: () => refine(() => setStatus("active")),
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={columns.length} />}
        {isError && <ErrorState what="bảng lương" onRetry={refetch} retrying={isFetching} />}

        {data && (
          <SectionCard
            title="Lương"
            icon={<Wallet size={17} />}
            meta={searchQuery ? `${monthLabel(month)} - khớp ${data.page.total}` : monthLabel(month)}
            action={
              canExport || canClose ? (
                <div className={styles.actions}>
                  {canExport && (
                    <Button variant="secondary" onClick={exportFile} disabled={exporting}>
                      <Download size={16} aria-hidden />
                      {exporting ? "Đang xuất…" : "Xuất Excel"}
                    </Button>
                  )}
                  {canClose && <SalaryClosingControl month={month} />}
                </div>
              ) : undefined
            }
          >
            <RankTable
              rows={data.page.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort={sort}
              caption={`Lương ${monthLabel(month)}`}
              emptyText={
                searchQuery
                  ? `Không tìm thấy nhân viên nào khớp “${searchQuery}”.`
                  : "Không có nhân viên nào khớp bộ lọc đang chọn."
              }
              server={{
                sort,
                dir,
                page,
                total: data.page.total,
                pageSize: PAGE_SIZE,
                onSortChange: (nextSort, nextDir) => {
                  setSort(nextSort as StaffSort);
                  setDir(nextDir);
                  setPage(0);
                },
                onPageChange: setPage,
              }}
            />
          </SectionCard>
        )}

        {adjusting && (
          <SalaryAdjustmentsDialog
            staff={adjusting.row}
            month={month}
            kind={adjusting.kind}
            mode={adjusting.mode}
            editable={editable}
            onClose={() => setAdjusting(null)}
          />
        )}
        {finalOf && (
          <SalaryBreakdownDialog
            amount={finalOf.salary}
            breakdown={finalOf.salaryBreakdown}
            onClose={() => setFinalOf(null)}
          />
        )}
      </main>
    </>
  );
}

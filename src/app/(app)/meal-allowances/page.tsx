"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Pencil, Utensils, X } from "lucide-react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { MealDaysDialog } from "@/components/payroll/MealDaysDialog";
import { MealHistoryDialog } from "@/components/payroll/MealHistoryDialog";
import { MealRejectDialog } from "@/components/payroll/MealRejectDialog";
import { MealStatusTag } from "@/components/payroll/MealStatusTag";
import { exportMeals } from "@/components/payroll/mealExcel";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { FilterChoices } from "@/components/ui/FilterChoices";
import { FilterField } from "@/components/ui/FilterField";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { fetchDepartments } from "@/lib/api/departments";
import {
  MEAL_START_MONTH,
  MEAL_STATUS_LABEL,
  MealStatus,
  actOnMeal,
  batchMeals,
  fetchMeals,
  mealMonthLabel,
  type MealBatchForm,
  type MealList,
  type MealQuery,
  type MealRow,
  type MealSort,
} from "@/lib/api/mealAllowances";
import { PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { formatPoints, formatVnd } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { canOpenMealAllowances } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./page.module.scss";

type Batch = { action: MealBatchForm["action"]; count: number };

const BATCH_DONE: Record<Batch["action"], string> = {
  "head-approve-all": "Đã duyệt",
  "approve-all": "Đã duyệt",
  processing: "Đã chuyển sang Đang xử lý",
  paid: "Đã chi ăn ca",
};

const BATCH_TITLE: Record<Batch["action"], string> = {
  "head-approve-all": "Duyệt cả phòng",
  "approve-all": "Duyệt tất cả",
  processing: "Đang xử lý",
  paid: "Đã chi ăn ca",
};

const BATCH_QUESTION: Record<Batch["action"], (n: number) => string> = {
  "head-approve-all": (n) => `Duyệt ${n} dòng ăn ca chờ Trưởng phòng duyệt?`,
  "approve-all": (n) => `Duyệt ${n} dòng ăn ca chờ kế toán duyệt?`,
  processing: (n) => `Chuyển ${n} dòng Kế toán đã duyệt sang Đang xử lý? Số ngày của các dòng này không đổi được nữa.`,
  paid: (n) => `Chuyển ${n} dòng Đang xử lý sang Đã chi ăn ca?`,
};

function metaOf(data: MealList): string {
  const rate = data.rate > 0 ? ` - ${formatVnd(data.rate)} một ngày` : "";
  const month = `Lương ${mealMonthLabel(data.month)}${rate}`;
  if (data.monthClosed) return `${month} - đã chốt lương`;
  if (data.mode === "head" && data.phase === "head-review") return `${month} - duyệt trước 00:00 ngày 1`;
  return month;
}

function emptyTextOf(data: MealList, search: string): string {
  if (data.month < MEAL_START_MONTH) return "Lương ăn ca có từ tháng 11/2026.";
  if (data.mode === "waiting") return "Kế toán xem danh sách từ 00:00 ngày 1 tháng sau.";
  if (data.phase === "before") return "Danh sách ăn ca có từ ngày cuối tháng.";
  if (search) return `Không tìm thấy dòng nào khớp “${search}”.`;
  return "Chưa có dòng ăn ca nào.";
}

/** Trưởng phòng sửa và duyệt ăn ca của phòng trong ngày cuối tháng; kế toán duyệt, xuất Excel và chi từ ngày 1 tháng sau. */
export default function MealAllowancesPage() {
  const queryClient = useQueryClient();
  // Rỗng = máy chủ chọn tháng mặc định: kế toán thấy tháng trước, Trưởng phòng thấy tháng này trong ngày cuối tháng.
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState<MealQuery["status"]>("");
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<MealSort>("name");
  const [dir, setDir] = useState<SortDir>("asc");

  const [editing, setEditing] = useState<MealRow | null>(null);
  const [approving, setApproving] = useState<MealRow | null>(null);
  const [rejecting, setRejecting] = useState<MealRow | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [exporting, setExporting] = useState(false);

  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const query: MealQuery = { month, status, departmentId, search: searchQuery, page, sort, dir };
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["meal-allowances", query],
    queryFn: () => fetchMeals(query),
    placeholderData: keepPreviousData,
  });
  const shownMonth = data?.month ?? month;
  const accounting = data?.mode === "accounting";

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
    enabled: Boolean(data?.companyWide),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["meal-allowances"] });
    void queryClient.invalidateQueries({ queryKey: ["meal-allowance"] });
    void queryClient.invalidateQueries({ queryKey: ["payroll"] });
    void queryClient.invalidateQueries({ queryKey: ["salary-adjustments"] });
    void queryClient.invalidateQueries({ queryKey: ["person"] });
  };

  const approve = useMutation({
    mutationFn: (row: MealRow) => actOnMeal(row.id, { action: "approve" }),
    onSuccess: (_d, row) => {
      toast.ok(`Đã duyệt ăn ca của ${row.fullName}`);
      setApproving(null);
      refresh();
    },
    // Máy chủ từ chối thường vì dòng vừa đổi: đóng hộp xác nhận và tải lại để người duyệt thấy số mới.
    onError: (e) => {
      toast.fail(errorMessage(e, "Không duyệt được."));
      setApproving(null);
      refresh();
    },
  });

  const runBatch = useMutation({
    mutationFn: (b: Batch) => batchMeals({ action: b.action, month: shownMonth }),
    onSuccess: (count, b) => {
      toast.ok(`${BATCH_DONE[b.action]} ${count} dòng`);
      setBatch(null);
      refresh();
    },
    onError: (e) => {
      toast.fail(errorMessage(e, "Không cập nhật được."));
      setBatch(null);
      refresh();
    },
  });

  const exportFile = async () => {
    setExporting(true);
    try {
      const rows = await exportMeals({ month: shownMonth, search: searchQuery, departmentId });
      toast.ok(`Đã xuất ${rows.length.toLocaleString("vi-VN")} dòng`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  const columns: RankColumn<MealRow>[] = [
    {
      key: "name",
      label: "Họ tên",
      sortable: true,
      render: (r) => {
        const subLine = [r.staffCode, r.left ? "Đã nghỉ" : ""].filter(Boolean).join(" - ");
        return (
          <button type="button" className={styles.nameButton} onClick={() => setHistoryOf(r.id)}>
            {r.fullName}
            {subLine && <span className={`${styles.subLine} tabular-nums`}>{subLine}</span>}
          </button>
        );
      },
    },
    { key: "title", label: "Chức danh", render: (r) => r.title || "—" },
    ...(data?.companyWide
      ? [{ key: "department", label: "Phòng", sortable: true, render: (r: MealRow) => r.departmentName || "—" }]
      : []),
    {
      key: "appDays",
      label: "App tính",
      render: (r) => <span className="tabular-nums">{r.appDays === null ? "—" : formatPoints(r.appDays)}</span>,
    },
    {
      key: "days",
      label: "Số ngày ăn ca",
      render: (r) => (
        <span className="tabular-nums">
          {formatPoints(r.days)}
          {r.editedDays !== null && <span className={styles.subLine}>Đã sửa</span>}
        </span>
      ),
    },
    { key: "amount", label: "Số tiền", render: (r) => <span className="tabular-nums">{formatVnd(r.amount)}</span> },
    {
      key: "status",
      label: "Trạng thái",
      render: (r) => (
        <>
          <MealStatusTag status={r.status} />
          {r.rejectReason && <span className={styles.reason}>{r.rejectReason}</span>}
        </>
      ),
    },
    {
      key: "actions",
      label: <span className="sr-only">Thao tác</span>,
      render: (r) =>
        r.canEdit || r.canApprove || r.canReject ? (
          <RowActions>
            {r.canApprove && (
              <Button aria-label={`Duyệt ăn ca của ${r.fullName}`} onClick={() => setApproving(r)}>
                Duyệt
              </Button>
            )}
            {r.canEdit && (
              <Button
                variant="secondary"
                icon
                tooltip="Sửa số ngày"
                aria-label={`Sửa số ngày ăn ca của ${r.fullName}`}
                onClick={() => setEditing(r)}
              >
                <Pencil size={16} aria-hidden />
              </Button>
            )}
            {r.canReject && (
              <Button
                variant="secondary"
                icon
                tooltip="Không chi riêng"
                aria-label={`Không chi riêng ăn ca của ${r.fullName}`}
                onClick={() => setRejecting(r)}
              >
                <X size={16} aria-hidden />
              </Button>
            )}
          </RowActions>
        ) : null,
    },
  ];

  const statusOptions = [
    { value: "", label: "Tất cả trạng thái" },
    ...MealStatus.options.map((s) => ({ value: s, label: MEAL_STATUS_LABEL[s] })),
  ];

  const open = data !== undefined && !data.monthClosed;
  const headReview = open && data.mode === "head" && data.phase === "head-review";

  return (
    <RequirePermission allow={canOpenMealAllowances}>
      <TopBar title="Lương ăn ca">
        <SearchField
          label="Tìm nhân viên"
          placeholder="Tìm tên, mã nhân viên, phòng…"
          value={search}
          onChange={(v) => refine(() => setSearch(v))}
        />
        <FilterButton
          activeCount={(status ? 1 : 0) + (departmentId ? 1 : 0)}
          onClear={() =>
            refine(() => {
              setStatus("");
              setDepartmentId("");
            })
          }
        >
          {shownMonth && (
            <FilterField id="month" label="Tháng">
              {/* Đọc tháng vừa chọn, không đợi dữ liệu: bấm "Tháng sau" hai lần lúc đang tải vẫn sang đủ hai tháng. */}
              <MonthPicker
                value={month || shownMonth}
                minMonth={MEAL_START_MONTH}
                onChange={(m) => refine(() => setMonth(m))}
              />
            </FilterField>
          )}
          <FilterField id="status" label="Trạng thái" count={status ? 1 : 0}>
            <FilterChoices
              label="Trạng thái"
              value={status}
              onChange={(v) => refine(() => setStatus(v as MealQuery["status"]))}
              options={statusOptions}
            />
          </FilterField>
          {data?.companyWide && (
            <FilterField id="department" label="Phòng" count={departmentId ? 1 : 0}>
              <FilterChoices
                label="Phòng"
                value={departmentId}
                onChange={(v) => refine(() => setDepartmentId(v))}
                options={[{ value: "", label: "Tất cả phòng" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
              />
            </FilterField>
          )}
        </FilterButton>
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(status
              ? [{ label: `Trạng thái: ${MEAL_STATUS_LABEL[status]}`, onRemove: () => refine(() => setStatus("")) }]
              : []),
            ...(departmentId
              ? [
                  {
                    label: `Phòng: ${departments.find((d) => d.id === departmentId)?.name ?? departmentId}`,
                    onRemove: () => refine(() => setDepartmentId("")),
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={columns.length} />}
        {isError && <ErrorState what="danh sách ăn ca" onRetry={refetch} retrying={isFetching} />}

        {data && (
          <SectionCard
            title="Lương ăn ca"
            icon={<Utensils size={17} />}
            meta={metaOf(data)}
            action={
              headReview && data.counts.headPending > 0 ? (
                <Button onClick={() => setBatch({ action: "head-approve-all", count: data.counts.headPending })}>
                  Duyệt cả phòng ({data.counts.headPending})
                </Button>
              ) : accounting && open ? (
                <div className={styles.actions}>
                  {data.counts.waiting > 0 && (
                    <Button onClick={() => setBatch({ action: "approve-all", count: data.counts.waiting })}>
                      Duyệt tất cả ({data.counts.waiting})
                    </Button>
                  )}
                  {/* Khoá số ngày chỉ khi không còn dòng chờ duyệt, kể cả dòng của chính người bấm. */}
                  {data.counts.unapproved === 0 && data.counts.approved > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => setBatch({ action: "processing", count: data.counts.approved })}
                    >
                      Chuyển Đang xử lý ({data.counts.approved})
                    </Button>
                  )}
                  {data.counts.processing > 0 && (
                    <Button variant="secondary" onClick={exportFile} disabled={exporting}>
                      <Download size={16} aria-hidden />
                      {exporting ? "Đang xuất…" : "Xuất Excel"}
                    </Button>
                  )}
                  {data.counts.processing > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => setBatch({ action: "paid", count: data.counts.processing })}
                    >
                      Đã chi ăn ca ({data.counts.processing})
                    </Button>
                  )}
                </div>
              ) : undefined
            }
          >
            <RankTable
              rows={data.page.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort={sort}
              caption={`Lương ăn ca ${mealMonthLabel(data.month)}`}
              emptyText={emptyTextOf(data, searchQuery)}
              server={{
                sort,
                dir,
                page,
                total: data.page.total,
                pageSize: PAGE_SIZE,
                onSortChange: (nextSort, nextDir) => {
                  setSort(nextSort as MealSort);
                  setDir(nextDir);
                  setPage(0);
                },
                onPageChange: setPage,
              }}
            />
          </SectionCard>
        )}

        {editing && <MealDaysDialog row={editing} onDone={refresh} onClose={() => setEditing(null)} />}
        {rejecting && <MealRejectDialog row={rejecting} onDone={refresh} onClose={() => setRejecting(null)} />}
        {historyOf && <MealHistoryDialog id={historyOf} onClose={() => setHistoryOf(null)} />}

        <ConfirmDialog
          open={approving !== null}
          title="Duyệt ăn ca"
          confirmLabel="Duyệt"
          pending={approve.isPending}
          onConfirm={() => approving && approve.mutate(approving)}
          onClose={() => setApproving(null)}
        >
          {approving &&
            `Duyệt ${formatPoints(approving.days)} ngày ăn ca, ${formatVnd(approving.amount)} cho ${approving.fullName}?`}
        </ConfirmDialog>

        <ConfirmDialog
          open={batch !== null}
          title={batch ? BATCH_TITLE[batch.action] : ""}
          confirmLabel={batch?.action === "head-approve-all" || batch?.action === "approve-all" ? "Duyệt" : "Chuyển"}
          pending={runBatch.isPending}
          onConfirm={() => batch && runBatch.mutate(batch)}
          onClose={() => setBatch(null)}
        >
          {batch && BATCH_QUESTION[batch.action](batch.count)}
        </ConfirmDialog>
      </main>
    </RequirePermission>
  );
}

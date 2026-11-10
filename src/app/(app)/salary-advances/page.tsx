"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, HandCoins, Pencil, X } from "lucide-react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { AdvanceAmountDialog } from "@/components/payroll/AdvanceAmountDialog";
import { AdvanceHistoryDialog } from "@/components/payroll/AdvanceHistoryDialog";
import { AdvanceRejectDialog } from "@/components/payroll/AdvanceRejectDialog";
import { AdvanceStatusTag } from "@/components/payroll/AdvanceStatusTag";
import { exportAdvances } from "@/components/payroll/advanceExcel";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { FilterChoices } from "@/components/ui/FilterChoices";
import { FilterField } from "@/components/ui/FilterField";
import { MonthPicker, monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { fetchDepartments } from "@/lib/api/departments";
import { PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import {
  ADVANCE_STATUS_LABEL,
  AdvanceStatus,
  actOnAdvance,
  batchAdvances,
  fetchAdvances,
  updateAdvanceAmount,
  type AdvanceList,
  type AdvanceQuery,
  type AdvanceRow,
  type AdvanceSort,
} from "@/lib/api/salaryAdvances";
import { formatVnd } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { canOpenSalaryAdvances } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./page.module.scss";

type Batch = { action: "approve-all" | "processing" | "paid"; count: number };

/** Trạng thái kế toán thấy: từ lúc Trưởng phòng đã duyệt trở đi. */
const ACCOUNTING_STATUSES: AdvanceStatus[] = ["head-approved", "approved", "rejected", "processing", "paid"];
/** Yêu cầu chưa chi xong: chỉ những dòng này mới cần so số tạm ứng với lương hiện tại. */
const UNSETTLED: AdvanceStatus[] = ["pending", "head-approved", "approved"];

function metaOf(data: AdvanceList): string {
  const month = monthLabel(data.month);
  if (data.mode === "accounting") return data.monthClosed ? `${month} - đã chốt lương` : month;
  if (data.phase === "submit" || data.phase === "head-review") return `${month} - duyệt trước 13:00 ngày 10`;
  return month;
}

/** Trưởng phòng duyệt tạm ứng của phòng trước 13:00 ngày 10; kế toán duyệt, xuất Excel và chi từ 13:00 ngày 10. */
export default function SalaryAdvancesPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(thisMonth);
  const [status, setStatus] = useState<AdvanceQuery["status"]>("");
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<AdvanceSort>("createdAt");
  const [dir, setDir] = useState<SortDir>("asc");

  const [editing, setEditing] = useState<AdvanceRow | null>(null);
  const [approving, setApproving] = useState<AdvanceRow | null>(null);
  const [rejecting, setRejecting] = useState<AdvanceRow | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [exporting, setExporting] = useState(false);

  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const query: AdvanceQuery = { month, status, departmentId, search: searchQuery, page, sort, dir };
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["salary-advances", query],
    queryFn: () => fetchAdvances(query),
    placeholderData: keepPreviousData,
  });
  const accounting = data?.mode === "accounting";

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
    enabled: accounting,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
    void queryClient.invalidateQueries({ queryKey: ["salary-advance"] });
    void queryClient.invalidateQueries({ queryKey: ["staff"] });
    void queryClient.invalidateQueries({ queryKey: ["salary-adjustments"] });
    void queryClient.invalidateQueries({ queryKey: ["person"] });
  };

  const approve = useMutation({
    mutationFn: (row: AdvanceRow) => actOnAdvance(row.id, { action: "approve", amount: row.amount }),
    onSuccess: (_d, row) => {
      toast.ok(`Đã duyệt tạm ứng của ${row.fullName}`);
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
    mutationFn: (b: Batch) => batchAdvances({ action: b.action, month }),
    onSuccess: (count, b) => {
      const label = { "approve-all": "Đã duyệt", processing: "Đã chuyển sang Đang xử lý", paid: "Đã chi tạm ứng" }[b.action];
      toast.ok(`${label} ${count} yêu cầu`);
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
      const rows = await exportAdvances({ month, search: searchQuery, departmentId });
      toast.ok(`Đã xuất ${rows.length.toLocaleString("vi-VN")} dòng`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  // Màn 1366px chỉ còn khoảng 1.000px cho bảng: mã nhân viên đi dòng phụ dưới tên, ngày gửi nằm ở Lịch sử.
  // Trưởng phòng chỉ thấy phòng mình nên không cần tên phòng; kế toán thấy cả công ty thì cần.
  const columns: RankColumn<AdvanceRow>[] = [
    {
      key: "name",
      label: "Nhân viên",
      sortable: true,
      render: (r) => {
        const subLine = [r.staffCode, data?.companyWide ? r.departmentName : ""].filter(Boolean).join(" - ");
        return (
          <button type="button" className={styles.nameButton} onClick={() => setHistoryOf(r.id)}>
            {r.fullName}
            {subLine && <span className={`${styles.subLine} tabular-nums`}>{subLine}</span>}
          </button>
        );
      },
    },
    {
      key: "amount",
      label: "Số tiền tạm ứng",
      sortable: true,
      render: (r) => <span className="tabular-nums">{formatVnd(r.amount)}</span>,
    },
    {
      key: "currentSalary",
      label: "Lương hiện tại",
      render: (r) => (
        <span className="tabular-nums">
          {formatVnd(r.currentSalary)}
          {UNSETTLED.includes(r.status) && r.amount > r.currentSalary && (
            <span className={styles.subLine}>Thấp hơn số tạm ứng</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      label: "Trạng thái",
      render: (r) => (
        <>
          <AdvanceStatusTag status={r.status} />
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
              <Button aria-label={`Duyệt tạm ứng của ${r.fullName}`} onClick={() => setApproving(r)}>
                Duyệt
              </Button>
            )}
            {r.canEdit && (
              <Button
                variant="secondary"
                icon
                tooltip="Sửa số tiền"
                aria-label={`Sửa số tiền tạm ứng của ${r.fullName}`}
                onClick={() => setEditing(r)}
              >
                <Pencil size={16} aria-hidden />
              </Button>
            )}
            {r.canReject && (
              <Button
                variant="secondary"
                icon
                tooltip="Từ chối"
                aria-label={`Từ chối tạm ứng của ${r.fullName}`}
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
    ...(accounting ? ACCOUNTING_STATUSES : AdvanceStatus.options).map((s) => ({ value: s, label: ADVANCE_STATUS_LABEL[s] })),
  ];

  return (
    <RequirePermission allow={canOpenSalaryAdvances}>
      <TopBar title="Tạm ứng lương">
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
          <FilterField id="month" label="Tháng">
            <MonthPicker value={month} onChange={(m) => refine(() => setMonth(m))} />
          </FilterField>
          <FilterField id="status" label="Trạng thái" count={status ? 1 : 0}>
            <FilterChoices
              label="Trạng thái"
              value={status}
              onChange={(v) => refine(() => setStatus(v as AdvanceQuery["status"]))}
              options={statusOptions}
            />
          </FilterField>
          {accounting && (
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
              ? [{ label: `Trạng thái: ${ADVANCE_STATUS_LABEL[status]}`, onRemove: () => refine(() => setStatus("")) }]
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
        {isError && <ErrorState what="danh sách tạm ứng" onRetry={refetch} retrying={isFetching} />}

        {data && (
          <SectionCard
            title="Yêu cầu tạm ứng"
            icon={<HandCoins size={17} />}
            meta={metaOf(data)}
            action={
              accounting ? (
                <div className={styles.actions}>
                  {data.counts.headApproved > 0 && !data.monthClosed && (
                    <Button onClick={() => setBatch({ action: "approve-all", count: data.counts.headApproved })}>
                      Duyệt tất cả ({data.counts.headApproved})
                    </Button>
                  )}
                  {/* Chỉ xuất khi đã duyệt hoặc từ chối hết, và còn yêu cầu Đã duyệt chưa chuyển Đang xử lý (chốt 2026-11-01). */}
                  {data.counts.headApproved === 0 && data.counts.approved > 0 && !data.monthClosed && (
                    <Button variant="secondary" onClick={exportFile} disabled={exporting}>
                      <Download size={16} aria-hidden />
                      {exporting ? "Đang xuất…" : "Xuất Excel"}
                    </Button>
                  )}
                  {data.counts.headApproved === 0 && data.counts.approved > 0 && !data.monthClosed && (
                    <Button
                      variant="secondary"
                      onClick={() => setBatch({ action: "processing", count: data.counts.approved })}
                    >
                      Chuyển Đang xử lý ({data.counts.approved})
                    </Button>
                  )}
                  {data.counts.processing > 0 && !data.monthClosed && (
                    <Button
                      variant="secondary"
                      onClick={() => setBatch({ action: "paid", count: data.counts.processing })}
                    >
                      Đã chi tạm ứng ({data.counts.processing})
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
              caption={`Tạm ứng lương ${monthLabel(month)}`}
              emptyText={
                data.mode === "waiting"
                  ? "Kế toán xem danh sách từ 13:00 ngày 10."
                  : searchQuery
                    ? `Không tìm thấy yêu cầu nào khớp “${searchQuery}”.`
                    : "Chưa có yêu cầu tạm ứng nào."
              }
              server={{
                sort,
                dir,
                page,
                total: data.page.total,
                pageSize: PAGE_SIZE,
                onSortChange: (nextSort, nextDir) => {
                  setSort(nextSort as AdvanceSort);
                  setDir(nextDir);
                  setPage(0);
                },
                onPageChange: setPage,
              }}
            />
          </SectionCard>
        )}

        {editing && (
          <AdvanceAmountDialog
            title={`Sửa tạm ứng - ${editing.fullName}`}
            initial={editing.amount}
            submitLabel="Lưu"
            onSubmit={(amount) => updateAdvanceAmount(editing.id, amount)}
            onDone={() => {
              toast.ok(`Đã sửa số tiền tạm ứng của ${editing.fullName}`);
              refresh();
            }}
            onFail={refresh}
            onClose={() => setEditing(null)}
          />
        )}
        {rejecting && (
          <AdvanceRejectDialog request={rejecting} onDone={refresh} onClose={() => setRejecting(null)} />
        )}
        {historyOf && <AdvanceHistoryDialog id={historyOf} onClose={() => setHistoryOf(null)} />}

        <ConfirmDialog
          open={approving !== null}
          title="Duyệt tạm ứng"
          confirmLabel="Duyệt"
          pending={approve.isPending}
          onConfirm={() => approving && approve.mutate(approving)}
          onClose={() => setApproving(null)}
        >
          {approving && (
            <>
              Duyệt tạm ứng {formatVnd(approving.amount)} cho {approving.fullName}?
              {!accounting && (
                <strong className={styles.responsibility}>
                  Trưởng phòng chịu hoàn toàn trách nhiệm về khoản tạm ứng này.
                </strong>
              )}
            </>
          )}
        </ConfirmDialog>

        <ConfirmDialog
          open={batch !== null}
          title={batch?.action === "approve-all" ? "Duyệt tất cả" : batch?.action === "paid" ? "Đã chi tạm ứng" : "Đang xử lý"}
          confirmLabel={batch?.action === "approve-all" ? "Duyệt" : "Chuyển"}
          pending={runBatch.isPending}
          onConfirm={() => batch && runBatch.mutate(batch)}
          onClose={() => setBatch(null)}
        >
          {batch?.action === "approve-all" && `Duyệt ${batch.count} yêu cầu Trưởng phòng đã duyệt?`}
          {batch?.action === "processing" && `Chuyển ${batch.count} yêu cầu Đã duyệt sang Đang xử lý?`}
          {batch?.action === "paid" && `Chuyển ${batch.count} yêu cầu Đang xử lý sang Đã chi tạm ứng?`}
        </ConfirmDialog>
      </main>
    </RequirePermission>
  );
}

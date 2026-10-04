"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileCheck2, HeartHandshake, Pencil, Sigma, Trash2, Upload } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import {
  SocialInsuranceImportDialog,
  type ImportMode,
} from "@/components/socialInsurance/SocialInsuranceImportDialog";
import { SocialInsuranceEditDialog } from "@/components/socialInsurance/SocialInsuranceEditDialog";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { ExcelColumnsDialog } from "@/components/ui/ExcelColumnsDialog";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { FilterChoices } from "@/components/ui/FilterChoices";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterField } from "@/components/ui/FilterField";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import {
  deleteRecord,
  differenceNote,
  differencesOf,
  fetchSocialInsurance,
  fetchSocialInsuranceForExport,
  fetchSocialInsuranceOptions,
  KIND_LABEL,
  PLAN_LABEL,
  RECONCILE_STATUS_LABEL,
  ReconcileStatus,
  SocialInsuranceKind,
  SocialInsurancePlan,
  statusOf,
  type SocialInsuranceFilters,
  type SocialInsuranceExportRow,
  type SocialInsurancePage,
  type SocialInsuranceRow,
} from "@/lib/api/socialInsurance";
import {
  EXCEL_GROUP_COLORS,
  excelColumnOptions,
  exportExcel,
  pickExcelColumns,
  type ExcelColumn,
  type ExcelColumnDef,
} from "@/lib/excel";
import { formatCount, formatDate, formatDateTime } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { decimalFromCents, formatCents, formatRate, RATE_SCALE } from "@/lib/money";
import { can, recordInScope, recordVisibility, scopeFor } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { isRealIsoDate } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const EMPTY: SocialInsurancePage = {
  rows: [],
  total: 0,
  totals: {
    rows: 0,
    customers: 0,
    collectedCents: 0,
    paidCents: 0,
    receivedCents: 0,
    bhyt: 0,
    bhxh: 0,
    newCount: 0,
    renewalCount: 0,
  },
};

const pageFromUrl = (value: string | null): number => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0;
};

const monthText = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;

/** % của một phần trên tiền thu, theo đơn vị 0,001%, làm tròn để hiện. */
const percentOf = (part: number, whole: number) =>
  whole > 0 ? formatRate(Math.round((part * RATE_SCALE) / whole)) : "—";

/** Số của file 1, kèm số của BHXH khi hai bên lệch. Ô lệch có chữ, không chỉ có màu. */
function Cell({ value, reconciled, mismatch }: { value: string; reconciled?: string; mismatch: boolean }) {
  if (!mismatch) return <>{value}</>;
  return (
    <span className={styles.mismatch}>
      {value}
      <span className={styles.reconciled}>Đối chiếu: {reconciled}</span>
    </span>
  );
}

const KHACH = { group: "Khách hàng", groupColor: EXCEL_GROUP_COLORS.customer };
const HO_SO = { group: "File hồ sơ", groupColor: EXCEL_GROUP_COLORS.account };
const DOI_CHIEU = { group: "File đối chiếu", groupColor: EXCEL_GROUP_COLORS.insurance };
const NHAN_SU = { group: "Nhân sự", groupColor: EXCEL_GROUP_COLORS.staff };

const money = (cents: number) => Number(decimalFromCents(cents));
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const dateOf = (value: string): Date | undefined =>
  isRealIsoDate(value) ? new Date(`${value}T00:00:00`) : undefined;

const sumCents = (rows: SocialInsuranceExportRow[], pick: (r: SocialInsuranceExportRow) => number) =>
  money(rows.reduce((s, r) => s + pick(r), 0));

/** Cột chọn được ở hộp thoại Xuất Excel. Ô file hồ sơ lệch file đối chiếu được tô, cột GHI CHÚ nói lệch gì. */
const EXCEL_COLUMNS: ExcelColumnDef<SocialInsuranceExportRow>[] = [
  { key: "createdAt", label: "Ngày giờ", ...KHACH, width: 17, value: (r) => formatDateTime(r.createdAt) },
  { key: "receiptMonth", label: "Tháng biên lai", ...KHACH, width: 12, type: "text", value: (r) => monthText(r.receiptMonth) },
  { key: "customerName", label: "Họ và tên", ...KHACH, width: 26, transform: "name", value: (r) => r.customerName },
  { key: "idNumber", label: "Số CCCD", ...KHACH, width: 15, type: "text", value: (r) => r.idNumber ?? "" },
  { key: "socialInsuranceCode", label: "Mã số BHXH", ...KHACH, width: 14, type: "text", value: (r) => r.socialInsuranceCode ?? "" },
  { key: "kind", label: "Loại", ...HO_SO, width: 8, value: (r) => KIND_LABEL[r.kind] },
  {
    key: "plan",
    label: "Phương án",
    ...HO_SO,
    width: 11,
    value: (r) => PLAN_LABEL[r.plan],
    highlight: (r) => differencesOf(r).includes("plan"),
  },
  {
    key: "months",
    label: "Số tháng",
    ...HO_SO,
    width: 9,
    type: "number",
    value: (r) => r.months,
    highlight: (r) => differencesOf(r).includes("months"),
  },
  {
    key: "collected",
    label: "Số tiền thu",
    ...HO_SO,
    width: 14,
    type: "number",
    total: (all) => sumCents(all, (r) => r.collectedCents),
    value: (r) => money(r.collectedCents),
    highlight: (r) => differencesOf(r).includes("collected"),
  },
  {
    key: "paid",
    label: "Số tiền chi",
    ...HO_SO,
    width: 13,
    type: "number",
    total: (all) => sumCents(all, (r) => r.paidCents),
    value: (r) => money(r.paidCents),
    highlight: (r) => differencesOf(r).includes("paid"),
  },
  { key: "paidRate", label: "% chi", ...HO_SO, width: 9, value: (r) => percentOf(r.paidCents, r.collectedCents) },
  { key: "collaborator", label: "CTV", ...HO_SO, width: 22, value: (r) => r.collaboratorName ?? "" },
  { key: "reconciledPlan", label: "Phương án đối chiếu", ...DOI_CHIEU, width: 11, value: (r) => (r.reconciliation ? PLAN_LABEL[r.reconciliation.plan] : "") },
  { key: "reconciledMonths", label: "Số tháng đối chiếu", ...DOI_CHIEU, width: 9, value: (r) => r.reconciliation?.months ?? "" },
  { key: "reconciledCollected", label: "Số tiền thu đối chiếu", ...DOI_CHIEU, width: 14, type: "number", value: (r) => (r.reconciliation ? money(r.reconciliation.collectedCents) : "") },
  {
    key: "reconciledPaid",
    label: "Số tiền chi đối chiếu",
    ...DOI_CHIEU,
    width: 14,
    type: "number",
    value: (r) => (r.reconciliation?.paidCents != null ? money(r.reconciliation.paidCents) : ""),
  },
  {
    key: "received",
    label: "Số tiền nhận",
    ...DOI_CHIEU,
    width: 13,
    type: "number",
    total: (all) => sumCents(all, (r) => r.reconciliation?.receivedCents ?? 0),
    value: (r) => (r.reconciliation ? money(r.reconciliation.receivedCents) : ""),
  },
  { key: "receivedRate", label: "% HH nhận", ...DOI_CHIEU, width: 9, value: (r) => (r.reconciliation ? formatRate(r.reconciliation.receivedRate) : "") },
  { key: "entryStaffCode", label: "Mã nhân viên ATM", ...NHAN_SU, width: 15, type: "text", value: (r) => r.entryStaffCode ?? "" },
  { key: "entryStaffName", label: "Nhân viên ATM", ...NHAN_SU, width: 22, value: (r) => r.entryStaffName },
  { key: "entryStaffDepartment", label: "Phòng nhân viên ATM", ...NHAN_SU, width: 22, value: (r) => r.entryStaffDepartmentName ?? "" },
  { key: "createdByCode", label: "Mã nhân viên AS", ...NHAN_SU, width: 15, type: "text", value: (r) => r.createdByCode ?? "" },
  { key: "createdByName", label: "Nhân viên AS", ...NHAN_SU, width: 22, value: (r) => r.createdByName },
  { key: "createdByDepartment", label: "Phòng nhân viên AS", ...NHAN_SU, width: 22, value: (r) => r.createdByDepartmentName ?? "" },
  { key: "note", label: "Ghi chú", group: "Ghi chú", width: 50, type: "text", value: (r) => differenceNote(r) },
];

const EXCEL_OPTIONS = excelColumnOptions(EXCEL_COLUMNS);

/** P-34 · BHYT/BHXH của Phòng An Sinh: file hồ sơ, file đối chiếu, ô tổng theo bộ lọc. */
export default function SocialInsuranceScreen() {
  const user = useSession((s) => s.user);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const searchQuery = useDebouncedValue(search);
  const [filters, setFilters] = useState<Omit<SocialInsuranceFilters, "search">>(() => {
    const kind = SocialInsuranceKind.safeParse(searchParams.get("kind"));
    const plan = SocialInsurancePlan.safeParse(searchParams.get("plan"));
    const status = ReconcileStatus.safeParse(searchParams.get("status"));
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    return {
      from: isRealIsoDate(from) ? from : "",
      to: isRealIsoDate(to) ? to : "",
      kind: kind.success ? kind.data : "",
      plan: plan.success ? plan.data : "",
      collaboratorId: searchParams.get("collaboratorId") ?? "",
      uploadedBy: searchParams.get("uploadedBy") ?? "",
      entryStaffId: searchParams.get("entryStaffId") ?? "",
      status: status.success ? status.data : "",
    };
  });
  const [page, setPage] = useState(() => pageFromUrl(searchParams.get("page")));
  const [dir, setDir] = useState<SortDir>(() => (searchParams.get("dir") === "asc" ? "asc" : "desc"));
  const [importing, setImporting] = useState<ImportMode | null>(null);
  const [editing, setEditing] = useState<SocialInsuranceRow | null>(null);
  const [removing, setRemoving] = useState<SocialInsuranceRow | null>(null);

  const query: SocialInsuranceFilters = { search: searchQuery, ...filters };
  const canFilterByUploader = scopeFor(user, "social-insurance", "view-detail") !== "own";

  const { data: options } = useQuery({
    queryKey: ["social-insurance", "options"],
    queryFn: fetchSocialInsuranceOptions,
    staleTime: 60_000,
  });

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (page > 0) params.set("page", String(page + 1));
    if (dir === "asc") params.set("dir", dir);
    const q = params.toString();
    return q ? `/social-insurance?${q}` : "/social-insurance";
  }, [dir, filters, page, searchQuery]);

  // Bộ lọc nằm trên URL để quay lại và chia sẻ được; URL là hệ thống ngoài React.
  useEffect(() => {
    window.history.replaceState(null, "", listUrl);
  }, [listUrl]);

  const refine = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const { data = EMPTY, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["social-insurance", "list", query, page, dir],
    queryFn: () => fetchSocialInsurance({ ...query, page, sort: "createdAt", dir }),
    placeholderData: keepPreviousData,
  });

  const activeCount = Object.entries(filters).filter(([key, value]) => key !== "to" && value).length;
  const filtering = Boolean(searchQuery) || activeCount > 0;

  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (row: SocialInsuranceRow) => deleteRecord(row.id),
    onSuccess: (_void, row) => {
      queryClient.invalidateQueries({ queryKey: ["social-insurance"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      invalidateKpi(queryClient);
      setRemoving(null);
      setPage((p) => (data.rows.length === 1 && p > 0 ? p - 1 : p));
      toast.ok(`Đã xoá hồ sơ ${KIND_LABEL[row.kind]} của ${row.customerName}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được hồ sơ này.")),
  });

  const [exporting, setExporting] = useState(false);
  const [choosingColumns, setChoosingColumns] = useState(false);
  const xuatExcel = async (keys: string[]) => {
    setExporting(true);
    try {
      const { rows, total } = await fetchSocialInsuranceForExport(query);
      const columns: ExcelColumn<SocialInsuranceExportRow>[] = [
        { header: "STT", group: "KHÁCH HÀNG", groupColor: EXCEL_GROUP_COLORS.customer, width: 7, type: "number", align: "center", total: (all) => all.length, value: (_r, i) => i + 1 },
        ...pickExcelColumns(EXCEL_COLUMNS, keys),
      ];
      await exportExcel({ fileName: `bhyt-bhxh-${iso(new Date())}.xlsx`, sheetName: "BHYT BHXH", columns, rows });
      setChoosingColumns(false);
      if (total > rows.length)
        toast.warn(`File có ${rows.length} trên ${total} hồ sơ khớp bộ lọc. Thu hẹp bộ lọc để lấy đủ.`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file"));
    } finally {
      setExporting(false);
    }
  };

  const editScope = recordVisibility(user, "social-insurance", "update");
  const removeScope = recordVisibility(user, "social-insurance", "delete");
  const hasActions = can(user, "social-insurance", "update") || can(user, "social-insurance", "delete");

  const columns: RankColumn<SocialInsuranceRow>[] = [
    { key: "createdAt", label: "Ngày giờ", sortable: true, render: (r) => formatDateTime(r.createdAt) },
    {
      key: "customerName",
      label: "Khách hàng",
      render: (r) => (
        <Link href={`/customers/${r.customerId}`} className={styles.nameLink}>
          {r.customerName}
        </Link>
      ),
    },
    { key: "socialInsuranceCode", label: "Mã số BHXH", render: (r) => r.socialInsuranceCode || "—" },
    { key: "kind", label: "Loại", render: (r) => KIND_LABEL[r.kind] },
    {
      key: "plan",
      label: "Phương án",
      render: (r) => (
        <Cell
          value={PLAN_LABEL[r.plan]}
          reconciled={r.reconciliation ? PLAN_LABEL[r.reconciliation.plan] : undefined}
          mismatch={differencesOf(r).includes("plan")}
        />
      ),
    },
    {
      key: "months",
      label: "Số tháng",
      render: (r) => (
        <Cell
          value={String(r.months)}
          reconciled={String(r.reconciliation?.months ?? "")}
          mismatch={differencesOf(r).includes("months")}
        />
      ),
    },
    {
      key: "collected",
      label: "Thu",
      render: (r) => (
        <Cell
          value={formatCents(r.collectedCents)}
          reconciled={r.reconciliation ? formatCents(r.reconciliation.collectedCents) : undefined}
          mismatch={differencesOf(r).includes("collected")}
        />
      ),
    },
    {
      key: "paid",
      label: "Chi",
      render: (r) => (
        <Cell
          value={formatCents(r.paidCents)}
          reconciled={r.reconciliation?.paidCents != null ? formatCents(r.reconciliation.paidCents) : undefined}
          mismatch={differencesOf(r).includes("paid")}
        />
      ),
    },
    { key: "paidRate", label: "% chi", render: (r) => percentOf(r.paidCents, r.collectedCents) },
    { key: "received", label: "Nhận", render: (r) => (r.reconciliation ? formatCents(r.reconciliation.receivedCents) : "—") },
    { key: "receivedRate", label: "% nhận", render: (r) => (r.reconciliation ? formatRate(r.reconciliation.receivedRate) : "—") },
    { key: "collaborator", label: "CTV", render: (r) => r.collaboratorName ?? "—" },
    {
      key: "entryStaffName",
      label: "Nhân viên ATM",
      render: (r) => (
        <Link href={`/users/${r.entryStaffId}`} className={styles.nameLink}>
          {r.entryStaffName}
        </Link>
      ),
    },
    {
      key: "createdByName",
      label: "Nhân viên AS",
      render: (r) => (
        <Link href={`/users/${r.createdById}`} className={styles.nameLink}>
          {r.createdByName}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Đối chiếu",
      render: (r) => {
        const status = statusOf(r);
        return (
          <StatusTag ok={status === "pending" ? null : status === "matched"}>
            {RECONCILE_STATUS_LABEL[status]}
          </StatusTag>
        );
      },
    },
    ...(hasActions
      ? [
          {
            key: "actions",
            label: "Thao tác",
            render: (r: SocialInsuranceRow) => (
              <RowActions>
                {!r.monthClosed && recordInScope(editScope, r) && (
                  <Button
                    variant="secondary"
                    icon
                    tooltip="Sửa"
                    aria-label={`Sửa hồ sơ ${KIND_LABEL[r.kind]} của ${r.customerName}`}
                    onClick={() => setEditing(r)}
                  >
                    <Pencil size={16} aria-hidden />
                  </Button>
                )}
                {!r.monthClosed && recordInScope(removeScope, r) && (
                  <Button
                    variant="secondary"
                    icon
                    tooltip="Xoá"
                    aria-label={`Xoá hồ sơ ${KIND_LABEL[r.kind]} của ${r.customerName}`}
                    onClick={() => setRemoving(r)}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                )}
              </RowActions>
            ),
          },
        ]
      : []),
  ];

  const nameOf = (list: { id: string; name: string }[] | undefined, id: string) =>
    list?.find((o) => o.id === id)?.name ?? "";
  const chip = (key: keyof typeof filters, label: string) =>
    filters[key] ? [{ label, onRemove: () => refine({ [key]: "" }) }] : [];

  const t = data.totals;
  const totals: [string, string][] = [
    ["Số khách", formatCount(t.customers)],
    ["Tổng tiền thu", formatCents(t.collectedCents)],
    ["Tổng tiền chi", formatCents(t.paidCents)],
    ["Tổng tiền nhận", formatCents(t.receivedCents)],
    ["Hồ sơ BHYT", formatCount(t.bhyt)],
    ["Hồ sơ BHXH", formatCount(t.bhxh)],
    ["Tăng mới", formatCount(t.newCount)],
    ["Tái tục", formatCount(t.renewalCount)],
  ];

  return (
    <>
      <TopBar title="BHYT/BHXH">
        <SearchField
          label="Tìm khách hàng"
          placeholder="Tìm tên, CCCD, mã số BHXH…"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() =>
            refine({
              from: "",
              to: "",
              kind: "",
              plan: "",
              collaboratorId: "",
              uploadedBy: "",
              entryStaffId: "",
              status: "",
            })
          }
        >
          <FilterField id="date" label="Khoảng ngày" count={filters.from ? 1 : 0}>
            <DateRangePicker
              hideLabel
              label="Khoảng ngày"
              value={filters.from ? { from: dateOf(filters.from), to: dateOf(filters.to) } : undefined}
              onChange={(v) => refine({ from: v?.from ? iso(v.from) : "", to: v?.to ? iso(v.to) : "" })}
            />
          </FilterField>
          <FilterField id="kind" label="Loại" count={filters.kind ? 1 : 0}>
            <FilterChoices
              label="Loại"
              value={filters.kind}
              onChange={(v) => refine({ kind: SocialInsuranceKind.safeParse(v).data ?? "" })}
              options={[
                { value: "", label: "Tất cả" },
                ...SocialInsuranceKind.options.map((k) => ({ value: k, label: KIND_LABEL[k] })),
              ]}
            />
          </FilterField>
          <FilterField id="plan" label="Phương án" count={filters.plan ? 1 : 0}>
            <FilterChoices
              label="Phương án"
              value={filters.plan}
              onChange={(v) => refine({ plan: SocialInsurancePlan.safeParse(v).data ?? "" })}
              options={[
                { value: "", label: "Tất cả" },
                ...SocialInsurancePlan.options.map((p) => ({ value: p, label: PLAN_LABEL[p] })),
              ]}
            />
          </FilterField>
          <FilterField id="collaborator" label="CTV" count={filters.collaboratorId ? 1 : 0}>
            <FilterChoices
              label="CTV"
              searchPlaceholder="Gõ để tìm CTV…"
              alwaysSearchable
              value={filters.collaboratorId}
              onChange={(v) => refine({ collaboratorId: v })}
              options={[
                { value: "", label: "Tất cả CTV" },
                ...(options?.collaborators ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </FilterField>
          {canFilterByUploader ? (
            <FilterField id="uploadedBy" label="Nhân viên AS" count={filters.uploadedBy ? 1 : 0}>
              <FilterChoices
                label="Nhân viên AS"
                searchPlaceholder="Gõ để tìm nhân viên…"
                alwaysSearchable
                value={filters.uploadedBy}
                onChange={(v) => refine({ uploadedBy: v })}
                options={[
                  { value: "", label: "Tất cả" },
                  ...(options?.uploaders ?? []).map((u) => ({ value: u.id, label: u.name })),
                ]}
              />
            </FilterField>
          ) : null}
          <FilterField id="entryStaff" label="Nhân viên ATM" count={filters.entryStaffId ? 1 : 0}>
            <FilterChoices
              label="Nhân viên ATM"
              searchPlaceholder="Gõ để tìm nhân viên…"
              alwaysSearchable
              value={filters.entryStaffId}
              onChange={(v) => refine({ entryStaffId: v })}
              options={[
                { value: "", label: "Tất cả" },
                ...(options?.entryStaff ?? []).map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </FilterField>
          <FilterField id="status" label="Đối chiếu" count={filters.status ? 1 : 0}>
            <FilterChoices
              label="Đối chiếu"
              value={filters.status}
              onChange={(v) => refine({ status: ReconcileStatus.safeParse(v).data ?? "" })}
              options={[
                { value: "", label: "Tất cả" },
                ...ReconcileStatus.options.map((s) => ({ value: s, label: RECONCILE_STATUS_LABEL[s] })),
              ]}
            />
          </FilterField>
        </FilterButton>
        {can(user, "social-insurance", "export") && (
          <Button
            variant="secondary"
            aria-label="Xuất Excel"
            disabled={exporting}
            onClick={() => setChoosingColumns(true)}
          >
            <Download size={16} aria-hidden />
            <span className={buttonStyles.label}>{exporting ? "Đang xuất…" : "Xuất Excel"}</span>
          </Button>
        )}
        {can(user, "social-insurance", "create") && (
          <ActionMenu
            label="Nhập file"
            icon={<Upload size={16} aria-hidden />}
            items={[
              {
                label: "Nhập file hồ sơ",
                icon: <FileSpreadsheet size={16} aria-hidden />,
                onSelect: () => setImporting("records"),
              },
              {
                label: "Nhập file đối chiếu",
                icon: <FileCheck2 size={16} aria-hidden />,
                onSelect: () => setImporting("reconcile"),
              },
            ]}
          />
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(filters.from
              ? [
                  {
                    label: `Ngày: ${formatDate(filters.from)} → ${formatDate(filters.to || filters.from)}`,
                    onRemove: () => refine({ from: "", to: "" }),
                  },
                ]
              : []),
            ...chip("kind", `Loại: ${filters.kind ? KIND_LABEL[filters.kind] : ""}`),
            ...chip("plan", `Phương án: ${filters.plan ? PLAN_LABEL[filters.plan] : ""}`),
            ...chip("collaboratorId", `CTV: ${nameOf(options?.collaborators, filters.collaboratorId)}`),
            ...chip("uploadedBy", `Nhân viên AS: ${nameOf(options?.uploaders, filters.uploadedBy)}`),
            ...chip("entryStaffId", `Nhân viên ATM: ${nameOf(options?.entryStaff, filters.entryStaffId)}`),
            ...chip("status", `Đối chiếu: ${filters.status ? RECONCILE_STATUS_LABEL[filters.status] : ""}`),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={8} />}
        {isError && <ErrorState what="danh sách BHYT/BHXH" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && (
          <>
            <SectionCard title="Tổng theo bộ lọc" icon={<Sigma size={17} />}>
              <dl className={styles.totals}>
                {totals.map(([label, value]) => (
                  <div key={label} className={styles.total}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
            <SectionCard title="Hồ sơ" icon={<HeartHandshake size={17} />} meta={`${formatCount(data.total)} hồ sơ`}>
              <RankTable
                rows={data.rows}
                columns={columns}
                rowKey={(r) => r.id}
                defaultSort="createdAt"
                caption="Hồ sơ theo ngày tải file"
                emptyText={filtering ? "Không có hồ sơ nào khớp bộ lọc." : "Chưa nhập file nào."}
                server={{
                  sort: "createdAt",
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
          </>
        )}

        {importing && <SocialInsuranceImportDialog open mode={importing} onClose={() => setImporting(null)} />}
        {editing && <SocialInsuranceEditDialog open record={editing} onClose={() => setEditing(null)} />}
        {choosingColumns && (
          <ExcelColumnsDialog
            screen="social-insurance"
            columns={EXCEL_OPTIONS}
            exporting={exporting}
            onClose={() => setChoosingColumns(false)}
            onExport={(keys) => void xuatExcel(keys)}
          />
        )}
        {removing && (
          <ConfirmDialog
            open
            title={`Xoá hồ sơ ${KIND_LABEL[removing.kind]}`}
            confirmLabel="Xoá"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(removing)}
            onClose={() => setRemoving(null)}
          >
            Bạn muốn xoá hồ sơ {KIND_LABEL[removing.kind]} tháng {monthText(removing.receiptMonth)} của{" "}
            {removing.customerName}?
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}

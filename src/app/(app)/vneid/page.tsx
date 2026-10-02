"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, IdCard, Image as ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { FilterChoices } from "@/components/ui/FilterChoices";
import { FilterField } from "@/components/ui/FilterField";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { CreateVneidDialog } from "@/components/vneid/CreateVneidDialog";
import { VneidFormDialog } from "@/components/vneid/VneidFormDialog";
import { fetchDepartments } from "@/lib/api/departments";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { fetchStaffOptions } from "@/lib/api/staff";
import {
  deleteVneidRecord,
  fetchVneidForExport,
  fetchVneidRecords,
  VNEID_TASKS,
  type VneidRow,
  type VneidTaskKey,
} from "@/lib/api/vneid";
import { formatDate, formatDateTime } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { can, recordInScope, recordVisibility, scopeFor } from "@/lib/permissions";
import { EXCEL_GROUP_COLORS, exportExcel, type ExcelColumn } from "@/lib/excel";
import { errorMessage, toast } from "@/lib/toast";
import { isRealIsoDate } from "@/lib/types";
import { useCreateIntent } from "@/lib/useCreateIntent";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const dateFromUrl = (value: string | null): Date | undefined =>
  value && isRealIsoDate(value) ? new Date(`${value}T00:00:00`) : undefined;

const pageFromUrl = (value: string | null): number => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0;
};

const taskFromUrl = (value: string | null): VneidTaskKey | "" =>
  VNEID_TASKS.find((t) => t.key === value)?.key ?? "";

/** Tích hợp VNeID — danh sách các lượt đã làm, cùng khuôn với màn Dịch vụ. */
export default function VneidPage() {
  const user = useSession((s) => s.user);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const searchQuery = useDebouncedValue(search);
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = dateFromUrl(searchParams.get("from"));
    const to = dateFromUrl(searchParams.get("to"));
    return from || to ? { from, to } : undefined;
  });
  const [departmentId, setDepartmentId] = useState(() => searchParams.get("departmentId") ?? "");
  const [staffId, setStaffId] = useState(() => searchParams.get("staffId") ?? "");
  const [task, setTask] = useState(() => taskFromUrl(searchParams.get("task")));
  const [page, setPage] = useState(() => pageFromUrl(searchParams.get("page")));
  const [dir, setDir] = useState<SortDir>(() => (searchParams.get("dir") === "asc" ? "asc" : "desc"));
  const [creating, setCreating] = useCreateIntent();
  const [editing, setEditing] = useState<VneidRow | null>(null);
  const [removing, setRemoving] = useState<VneidRow | null>(null);
  const [viewingPhotos, setViewingPhotos] = useState<VneidRow | null>(null);

  const canFilterByStaff = scopeFor(user, "vneid", "view-detail") !== "own";
  const canFilterByDepartment = useMemo(() => {
    const scope = recordVisibility(user, "vneid", "view-detail");
    return scope.kind === "all" || (scope.kind === "departments" && scope.departmentIds.length > 1);
  }, [user]);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    retry: false,
    staleTime: Infinity,
    enabled: canFilterByDepartment,
  });
  const departmentOptions = useMemo(() => {
    const scope = recordVisibility(user, "vneid", "view-detail");
    const inScope =
      scope.kind === "departments"
        ? departments.filter((d) => scope.departmentIds.includes(d.id))
        : departments;
    return inScope.map((d) => ({ value: d.id, label: d.name }));
  }, [user, departments]);

  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    retry: false,
    staleTime: Infinity,
    enabled: canFilterByStaff,
  });
  const staffOptions = useMemo(() => staff.map((s) => ({ value: s.id, label: s.fullName })), [staff]);

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (departmentId) params.set("departmentId", departmentId);
    if (staffId) params.set("staffId", staffId);
    if (task) params.set("task", task);
    if (page > 0) params.set("page", String(page + 1));
    if (dir === "asc") params.set("dir", dir);
    const query = params.toString();
    return query ? `/vneid?${query}` : "/vneid";
  }, [departmentId, dir, from, page, searchQuery, staffId, task, to]);

  // Bộ lọc nằm trên URL để quay lại và chia sẻ được; URL là hệ thống ngoài React.
  useEffect(() => {
    window.history.replaceState(null, "", listUrl);
  }, [listUrl]);

  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["vneid", searchQuery, from, to, departmentId, staffId, task, page, dir],
    queryFn: () =>
      fetchVneidRecords({
        search: searchQuery,
        from,
        to,
        departmentId,
        staffId,
        customerId: "",
        task,
        page,
        sort: "createdAt",
        dir,
      }),
    placeholderData: keepPreviousData,
  });

  const activeCount =
    (from && to ? 1 : 0) + (departmentId ? 1 : 0) + (staffId ? 1 : 0) + (task ? 1 : 0);
  const filtering = Boolean(searchQuery) || activeCount > 0;

  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (row: VneidRow) => deleteVneidRecord(row.id),
    onSuccess: (_void, row) => {
      queryClient.invalidateQueries({ queryKey: ["vneid"] });
      setRemoving(null);
      setPage((p) => (data.rows.length === 1 && p > 0 ? p - 1 : p));
      toast.ok(`Đã xoá lượt VNeID của ${row.customerName}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được lượt VNeID này.")),
  });

  /** Xuất đúng bộ lọc đang xem, trọn danh sách chứ không chỉ trang đang hiện. */
  const [exporting, setExporting] = useState(false);
  const xuatExcel = async () => {
    setExporting(true);
    try {
      const { rows, total } = await fetchVneidForExport({
        search: searchQuery,
        from,
        to,
        departmentId,
        staffId,
        customerId: "",
        task,
      });
      // Đầu bảng 3 tầng theo chuẩn chung ở AGENTS.md §12: nhóm, tổng, tên cột.
      const KHACH = { group: "KHÁCH HÀNG", groupColor: EXCEL_GROUP_COLORS.customer };
      const VIEC = { group: "VIỆC ĐÃ LÀM", groupColor: EXCEL_GROUP_COLORS.account };
      const NHAN_SU = { group: "NHÂN SỰ", groupColor: EXCEL_GROUP_COLORS.staff };
      const columns: ExcelColumn<VneidRow>[] = [
        { header: "STT", ...KHACH, width: 7, type: "number", align: "center", total: (all) => all.length, value: (_r, i) => i + 1 },
        { header: "NGÀY GIỜ", ...KHACH, width: 17, value: (r) => formatDateTime(r.createdAt) },
        { header: "TÊN KHÁCH HÀNG", ...KHACH, width: 28, transform: "name", value: (r) => r.customerName },
        { header: "ĐỊA CHỈ", ...KHACH, width: 36, value: (r) => r.customerAddress },
        ...VNEID_TASKS.map(
          (t): ExcelColumn<VneidRow> => ({
            header: t.label.toUpperCase(),
            ...VIEC,
            width: 12,
            align: "center",
            total: (all) => all.filter((r) => r[t.key]).length,
            value: (r) => (r[t.key] ? "Có" : ""),
          }),
        ),
        { header: "MÃ NHÂN VIÊN", ...NHAN_SU, width: 16, type: "text", value: (r) => r.createdByCode ?? "" },
        { header: "NGƯỜI THỰC HIỆN", ...NHAN_SU, width: 24, value: (r) => r.createdByName },
        { header: "PHÒNG", ...NHAN_SU, width: 24, value: (r) => r.createdByDepartmentName ?? "" },
        { header: "GHI CHÚ", group: "GHI CHÚ", width: 40, type: "text", value: (r) => r.note },
      ];
      await exportExcel({ fileName: `vneid-${iso(new Date())}.xlsx`, sheetName: "VNeID", columns, rows });
      if (total > rows.length)
        toast.warn(`File có ${rows.length} trên ${total} dòng khớp bộ lọc. Thu hẹp bộ lọc để lấy đủ.`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file"));
    } finally {
      setExporting(false);
    }
  };

  const editScope = recordVisibility(user, "vneid", "update");
  const removeScope = recordVisibility(user, "vneid", "delete");
  const hasActions = can(user, "vneid", "update") || can(user, "vneid", "delete");

  const columns: RankColumn<VneidRow>[] = [
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
    { key: "customerAddress", label: "Địa chỉ", render: (r) => r.customerAddress || "—" },
    ...VNEID_TASKS.map(
      (t): RankColumn<VneidRow> => ({
        key: t.key,
        label: t.label,
        render: (r) => (r[t.key] ? <StatusTag ok>Có</StatusTag> : "—"),
      }),
    ),
    {
      key: "createdByName",
      label: "Người thực hiện",
      render: (r) => (
        <Link href={`/users/${r.createdById}`} className={styles.nameLink}>
          {r.createdByName}
        </Link>
      ),
    },
    {
      key: "photos",
      label: "Ảnh",
      render: (r) =>
        r.photoUrls.length > 0 ? (
          <Button
            variant="secondary"
            icon
            tooltip={`Xem ${r.photoUrls.length} ảnh`}
            aria-label={`Xem ${r.photoUrls.length} ảnh VNeID của ${r.customerName}`}
            onClick={() => setViewingPhotos(r)}
          >
            <ImageIcon size={16} aria-hidden />
          </Button>
        ) : (
          "—"
        ),
    },
    { key: "note", label: "Ghi chú", render: (r) => r.note || "—" },
    ...(hasActions
      ? [
          {
            key: "actions",
            label: "Thao tác",
            render: (r: VneidRow) => (
              <RowActions>
                {!r.monthClosed && recordInScope(editScope, r) && (
                  <Button
                    variant="secondary"
                    icon
                    tooltip="Sửa"
                    aria-label={`Sửa lượt VNeID của ${r.customerName}`}
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
                    aria-label={`Xoá lượt VNeID của ${r.customerName}`}
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

  return (
    <>
      <TopBar title="VNeID">
        <SearchField
          label="Tìm khách hàng"
          placeholder="Tìm tên khách hàng…"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() =>
            refine(() => {
              setRange(undefined);
              setDepartmentId("");
              setStaffId("");
              setTask("");
            })
          }
        >
          <FilterField id="date" label="Khoảng ngày" count={range?.from ? 1 : 0}>
            <DateRangePicker
              hideLabel
              label="Khoảng ngày"
              value={range}
              onChange={(v) => refine(() => setRange(v))}
            />
          </FilterField>
          <FilterField id="task" label="Việc đã làm" count={task ? 1 : 0}>
            <FilterChoices
              label="Việc đã làm"
              value={task}
              onChange={(v) => refine(() => setTask(taskFromUrl(v)))}
              options={[
                { value: "", label: "Tất cả" },
                ...VNEID_TASKS.map((t) => ({ value: t.key, label: t.label })),
              ]}
            />
          </FilterField>
          {canFilterByDepartment ? (
            <FilterField id="department" label="Phòng" count={departmentId ? 1 : 0}>
              <FilterChoices
                label="Phòng"
                value={departmentId}
                onChange={(v) => refine(() => setDepartmentId(v))}
                options={[{ value: "", label: "Tất cả phòng" }, ...departmentOptions]}
              />
            </FilterField>
          ) : null}
          {canFilterByStaff ? (
            <FilterField id="staff" label="Nhân viên" count={staffId ? 1 : 0}>
              <FilterChoices
                label="Nhân viên"
                searchPlaceholder="Gõ để tìm nhân viên…"
                value={staffId}
                onChange={(v) => refine(() => setStaffId(v))}
                options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
              />
            </FilterField>
          ) : null}
        </FilterButton>
        {can(user, "vneid", "export") && (
          <Button
            variant="secondary"
            aria-label="Xuất Excel"
            disabled={exporting}
            onClick={() => void xuatExcel()}
          >
            <Download size={16} aria-hidden />
            <span className={buttonStyles.label}>{exporting ? "Đang xuất…" : "Xuất Excel"}</span>
          </Button>
        )}
        {can(user, "vneid", "create") && (
          <Button
            aria-label="Tích hợp VNeID"
            className={buttonStyles.hideOnMobile}
            onClick={() => setCreating(true)}
          >
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Tích hợp VNeID</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(from && to
              ? [
                  {
                    label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`,
                    onRemove: () => refine(() => setRange(undefined)),
                  },
                ]
              : []),
            ...(task
              ? [
                  {
                    label: `Việc: ${VNEID_TASKS.find((t) => t.key === task)?.label ?? ""}`,
                    onRemove: () => refine(() => setTask("")),
                  },
                ]
              : []),
            ...(departmentId
              ? [
                  {
                    label: `Phòng: ${departments.find((d) => d.id === departmentId)?.name ?? ""}`,
                    onRemove: () => refine(() => setDepartmentId("")),
                  },
                ]
              : []),
            ...(staffId
              ? [
                  {
                    label: `Nhân viên: ${staffOptions.find((s) => s.value === staffId)?.label ?? ""}`,
                    onRemove: () => refine(() => setStaffId("")),
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={7} />}
        {isError && <ErrorState what="danh sách VNeID" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && (
          <SectionCard title="Lượt tích hợp VNeID" icon={<IdCard size={17} />} meta={`${data.total} dòng`}>
            <RankTable
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort="createdAt"
              caption="Lượt tích hợp VNeID cho khách hàng"
              emptyText={filtering ? "Không có lượt nào khớp bộ lọc." : "Chưa ghi lượt VNeID nào."}
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
        )}

        {creating && <CreateVneidDialog open onClose={() => setCreating(false)} />}
        {editing && (
          <VneidFormDialog
            open
            record={editing}
            customerId={editing.customerId}
            customerName={editing.customerName}
            onClose={() => setEditing(null)}
          />
        )}
        {viewingPhotos && (
          <ImageLightbox
            photos={viewingPhotos.photoUrls.map((src, i) => ({
              src,
              alt: `Ảnh ${i + 1} VNeID của ${viewingPhotos.customerName}`,
            }))}
            onClose={() => setViewingPhotos(null)}
          />
        )}
        {removing && (
          <ConfirmDialog
            open
            title="Xoá lượt VNeID"
            confirmLabel="Xoá"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(removing)}
            onClose={() => setRemoving(null)}
          >
            Bạn muốn xoá lượt VNeID của {removing.customerName}, lúc {formatDateTime(removing.createdAt)}?
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}

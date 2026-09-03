"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { CreateServiceDialog } from "@/components/services/CreateServiceDialog";
import { ServiceEditDialog } from "@/components/services/ServiceEditDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import buttonStyles from "@/components/ui/Button.module.css";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { deleteService, fetchServices, type ServiceRow } from "@/lib/api/services";
import { fetchServiceTypes } from "@/lib/api/settings";
import { fetchStaffOptions } from "@/lib/api/staff";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { can, scopeFor } from "@/lib/permissions";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";
import { isRealIsoDate } from "@/lib/types";
import { useSession } from "@/store/session";
import type { DateRange } from "react-day-picker";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** URL chỉ nhận ngày có thật — `2026-02-31` không được thành tháng Ba mà không báo gì. */
const dateFromUrl = (value: string | null): Date | undefined =>
  value && isRealIsoDate(value) ? new Date(`${value}T00:00:00`) : undefined;

const pageFromUrl = (value: string | null): number => {
  const page = Number(value);
  // URL đếm từ 1 để người dùng đọc được; `RankTable` đếm từ 0 nội bộ.
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0;
};

/** P-31 · Danh sách dịch vụ — không có màn chi tiết riêng (không có P-32). */
export default function ServicesPage() {
  const user = useSession((s) => s.user);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const searchQuery = useDebouncedValue(search);
  const [serviceTypeId, setServiceTypeId] = useState(
    () => searchParams.get("serviceTypeId") ?? "",
  );
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = dateFromUrl(searchParams.get("from"));
    const to = dateFromUrl(searchParams.get("to"));
    return from || to ? { from, to } : undefined;
  });
  const [wardId, setWardId] = useState(() => searchParams.get("wardId") ?? "");
  const [staffId, setStaffId] = useState(() => searchParams.get("staffId") ?? "");
  const [page, setPage] = useState(() => pageFromUrl(searchParams.get("page")));
  // Chỉ sắp theo ngày, và chỉ đổi được chiều — `SERVICE_SORT` có đúng một khoá
  // vì sắp theo tên khách/loại/người làm thì phải nối bảng trước khi cắt trang.
  const [dir, setDir] = useState<SortDir>(() =>
    searchParams.get("dir") === "asc" ? "asc" : "desc",
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [removing, setRemoving] = useState<ServiceRow | null>(null);

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["service-types"],
    queryFn: fetchServiceTypes,
  });
  const { data: provinces = [] } = useQuery({ queryKey: ["provinces"], queryFn: fetchProvinces });
  const wards = useMemo(() => provinces.flatMap((p) => p.wards), [provinces]);

  /**
   * Ô lọc "Nhân viên" đọc TRỌN danh sách, không gom từ các dòng đang hiện.
   *
   * Gom từ dòng thì ô chọn chỉ có những người tình cờ nằm ở trang đang xem —
   * lọc theo người thứ 16 trở đi là không chọn được. Hỏng thì để rỗng chứ không
   * chặn cả màn.
   */
  // Phạm vi 'own' thì bảng chỉ có dịch vụ của chính mình — ô lọc Nhân viên
  // không có ai khác để chọn, và lời gọi danh sách nhân viên chắc chắn 403.
  const canFilterByStaff = scopeFor(user, "services", "view-detail") !== "own";

  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    retry: false,
    staleTime: Infinity,
    enabled: canFilterByStaff,
  });
  const staffOptions = useMemo(
    () => staff.map((s) => ({ value: s.id, label: s.fullName })),
    [staff],
  );

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  /**
   * Danh sách là một trạng thái quay lại và chia sẻ được, nên mọi thứ làm đổi
   * kết quả đều nằm trên URL. `replaceState` không thêm một mục lịch sử theo
   * từng ký tự gõ.
   */
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (serviceTypeId) params.set("serviceTypeId", serviceTypeId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (wardId) params.set("wardId", wardId);
    if (staffId) params.set("staffId", staffId);
    if (page > 0) params.set("page", String(page + 1));
    if (dir === "asc") params.set("dir", dir);
    const query = params.toString();
    return query ? `/services?${query}` : "/services";
  }, [dir, from, page, searchQuery, serviceTypeId, staffId, to, wardId]);

  useEffect(() => {
    window.history.replaceState(null, "", listUrl);
  }, [listUrl]);

  /** Đổi bộ lọc thì về trang đầu — giữ trang 5 của kết quả cũ là hiện khúc rỗng. */
  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["services", searchQuery, serviceTypeId, from, to, wardId, staffId, page, dir],
    queryFn: () =>
      fetchServices({
        search: searchQuery,
        serviceTypeId,
        from,
        to,
        wardId,
        staffId,
        page,
        sort: "date",
        dir,
      }),
    placeholderData: keepPreviousData,
  });

  const activeCount =
    (serviceTypeId ? 1 : 0) + (from && to ? 1 : 0) + (wardId ? 1 : 0) + (staffId ? 1 : 0);
  // Cột Thao tác chỉ dựng khi bấm vào có tác dụng — một cột nút bấm không được
  // là lời hứa suông (AGENTS.md §6: ẩn nút không phải phân quyền, nhưng hiện
  // nút không làm gì thì là nói dối).
  const canEdit = can(user, "services", "update");
  const canRemove = can(user, "services", "delete");

  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (row: ServiceRow) => deleteService(row.id),
    onSuccess: (_void, row) => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      // Xoá dịch vụ là tính lại điểm KPI của người đã làm — bảng nhân sự phải
      // tải lại, không thì số cũ còn nằm đó tới khi hết staleTime.
      invalidateKpi(queryClient);
      setRemoving(null);
      // Lùi TRƯỚC khi gọi lại: chỗ này biết trang vừa mất dòng cuối, `RankTable`
      // thì chỉ biết sau khi máy chủ đã trả về một trang rỗng. Bỏ dòng này thì
      // người dùng thấy chữ "Chưa có dịch vụ nào" suốt một lượt gọi mạng.
      setPage((p) => (data.rows.length === 1 && p > 0 ? p - 1 : p));
      toast.ok(`Đã xoá dịch vụ của ${row.customerName}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được dịch vụ này.")),
  });
  const filtering = Boolean(searchQuery) || activeCount > 0;

  const columns = useMemo<RankColumn<ServiceRow>[]>(
    () => [
      {
        key: "date",
        label: "Ngày",
        sortable: true,
        render: (r) => formatDate(r.date),
      },
      {
        key: "customerName",
        label: "Khách hàng",
        render: (r) => (
          <Link href={`/customers/${r.customerId}`} className={styles.nameLink}>
            {r.customerName}
          </Link>
        ),
      },
      { key: "serviceTypeName", label: "Loại dịch vụ", render: (r) => r.serviceTypeName },
      { key: "wardName", label: "Xã", render: (r) => r.wardName ?? "—" },
      {
        key: "createdByName",
        label: "Người thực hiện",
        render: (r) => (
          <Link href={`/users/${r.createdById}`} className={styles.nameLink}>
            {r.createdByName}
          </Link>
        ),
      },
      { key: "note", label: "Ghi chú", render: (r) => r.note || "—" },
      ...(canEdit || canRemove
        ? [
            {
              key: "actions",
              label: "Thao tác",
              // Nút chỉ có icon nên `aria-label` phải kèm tên khách: giữa mười
              // lăm dòng giống nhau, "Sửa" một mình không nói đang sửa dòng nào.
              render: (r: ServiceRow) => (
                <RowActions>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      icon
                      tooltip="Sửa dịch vụ"
                      aria-label={`Sửa dịch vụ ${r.serviceTypeName} của ${r.customerName}`}
                      onClick={() => setEditing(r)}
                    >
                      <Pencil size={16} aria-hidden />
                    </Button>
                  )}
                  {canRemove && (
                    <Button
                      variant="secondary"
                      icon
                      tooltip="Xoá dịch vụ"
                      aria-label={`Xoá dịch vụ ${r.serviceTypeName} của ${r.customerName}`}
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
    ],
    [canEdit, canRemove],
  );

  return (
    <>
      <TopBar title="Dịch vụ">
        <SearchField
          label="Tìm khách hàng"
          placeholder="Tìm tên khách hàng…"
          value={search}
          onChange={(v) => {
            // Về trang đầu ngay lúc gõ, không đợi hoãn xong: đang ở trang 3 mà
            // kết quả mới chỉ có 2 dòng thì trang 3 là một khúc rỗng.
            setSearch(v);
            setPage(0);
          }}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() =>
            refine(() => {
              setServiceTypeId("");
              setRange(undefined);
              setWardId("");
              setStaffId("");
            })
          }
        >
          <Select
            block
            label="Loại dịch vụ"
            value={serviceTypeId}
            onChange={(v) => refine(() => setServiceTypeId(v))}
            options={[
              { value: "", label: "Tất cả loại dịch vụ" },
              ...serviceTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <DateRangePicker label="Khoảng ngày" value={range} onChange={(v) => refine(() => setRange(v))} />
          <Select
            block
            label="Xã"
            value={wardId}
            // Lọc theo id chứ không theo tên: bản ghi chụp cả hai, mà xã đổi tên
            // thì lọc theo tên bỏ sót đúng những dòng cũ cần tìm.
            onChange={(v) => refine(() => setWardId(v))}
            options={[
              { value: "", label: "Tất cả xã" },
              ...wards.map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
          {canFilterByStaff && (
            <Combobox
              block
              // Combobox chứ không phải Select: công ty có hàng trăm nhân viên,
              // mà `<select>` gốc không gõ tìm được.
              label="Nhân viên"
              placeholder="Gõ để tìm nhân viên…"
              value={staffId}
              onChange={(v) => refine(() => setStaffId(v))}
              options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
            />
          )}
        </FilterButton>
        {can(user, "services", "create") && (
          <Button aria-label="Ghi dịch vụ" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Ghi dịch vụ</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(serviceTypeId
              ? [
                  {
                    label: `Loại dịch vụ: ${serviceTypes.find((t) => t.id === serviceTypeId)?.name ?? ""}`,
                    onRemove: () => refine(() => setServiceTypeId("")),
                  },
                ]
              : []),
            ...(from && to
              ? [
                  {
                    label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`,
                    onRemove: () => refine(() => setRange(undefined)),
                  },
                ]
              : []),
            ...(wardId
              ? [
                  {
                    label: `Xã: ${wards.find((w) => w.id === wardId)?.name ?? ""}`,
                    onRemove: () => refine(() => setWardId("")),
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

        {isPending && <SkeletonTable rows={8} columns={6} />}
        {isError && (
          <ErrorState what="danh sách dịch vụ" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <SectionCard
            title="Dịch vụ đã thực hiện"
            icon={<Briefcase size={17} />}
            meta={`${data.total} dòng`}
          >
            <RankTable
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort="date"
              caption="Dịch vụ đã thực hiện cho khách hàng"
              emptyText={
                filtering
                  ? "Không có dịch vụ nào khớp bộ lọc."
                  : "Chưa ghi dịch vụ nào."
              }
              server={{
                sort: "date",
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

        {creating && <CreateServiceDialog open onClose={() => setCreating(false)} />}
        {editing && (
          <ServiceEditDialog open service={editing} onClose={() => setEditing(null)} />
        )}
        {removing && (
          <ConfirmDialog
            open
            title="Xoá dịch vụ này?"
            consequence="Điểm KPI của người thực hiện sẽ được tính lại ngay. Xoá rồi không lấy lại được."
            confirmLabel="Xoá"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(removing)}
            onClose={() => setRemoving(null)}
          >
            <strong>{removing.serviceTypeName}</strong> cho {removing.customerName}, ngày{" "}
            {formatDate(removing.date)}, do {removing.createdByName} thực hiện.
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}

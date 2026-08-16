"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Pencil, Plus, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import { CreateInsuranceOrderDialog } from "@/components/insurance/CreateInsuranceOrderDialog";
import { InsuranceOrderEditDialog } from "@/components/insurance/InsuranceOrderEditDialog";
import {
  deleteInsuranceOrder,
  fetchInsuranceOrders,
  setInsuranceOrderStatus,
  type InsuranceListRow,
} from "@/lib/api/insurance";
import {
  INSURANCE_STATUS_LABEL,
  INSURANCE_STATUS_TONE,
  InsuranceOrderStatus,
} from "@/lib/api/insuranceOrders";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { fetchStaffOptions } from "@/lib/api/staff";
import { formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { can, recordInScope, recordVisibility } from "@/lib/permissions";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";
import { InsuranceProduct, PRODUCT_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/**
 * P-13 · Danh sách đơn bảo hiểm.
 *
 * Hàng đợi đơn lỗi (P-15) KHÔNG phải màn riêng — nó là màn này lọc theo trạng
 * thái `Chờ làm tay`.
 */
export default function InsurancePage() {
  const user = useSession((s) => s.user);
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [status, setStatus] = useState<InsuranceOrderStatus | "">("");
  const [product, setProduct] = useState<InsuranceProduct | "">("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [staffId, setStaffId] = useState("");
  /** Đơn có hai người liên quan — ô lọc phải nói rõ đang hỏi vai nào. */
  const [staffRole, setStaffRole] = useState<"any" | "creator" | "handler">("any");
  const [page, setPage] = useState(0);
  // Chỉ sắp theo ngày hiệu lực, và chỉ đổi được chiều — `INSURANCE_SORT` có đúng
  // một khoá vì sắp theo tên khách/người tạo thì phải nối bảng trước khi cắt trang.
  const [dir, setDir] = useState<SortDir>("desc");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InsuranceListRow | null>(null);
  const [removing, setRemoving] = useState<InsuranceListRow | null>(null);

  /**
   * Ô lọc "Nhân viên" đọc TRỌN danh sách, không gom từ các dòng đang hiện.
   *
   * Gom từ dòng thì ô chọn chỉ có những người tình cờ nằm ở trang đang xem —
   * lọc theo người thứ 16 trở đi là không chọn được.
   *
   * Màn này KHÔNG ẩn ô lọc như P-21/P-31 (chốt 2026-08-16). Nhân viên xem được
   * đơn ngoài phần mình nhưng không đọc nổi danh bạ, nên vẫn cần tách "đơn tôi
   * làm" khỏi phần còn lại — với nhóm đó ô lọc rút còn Tất cả · Của tôi.
   */
  const canPickAnyStaff = can(user, "staff", "view-detail");

  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    retry: false,
    staleTime: Infinity,
    enabled: canPickAnyStaff,
  });
  /** Cũng là nguồn của nhãn trên thẻ lọc bên dưới — hai chỗ phải đọc một danh sách. */
  const staffOptions = useMemo(() => {
    if (canPickAnyStaff) return staff.map((s) => ({ value: s.id, label: s.fullName }));
    return user ? [{ value: user.id, label: "Của tôi" }] : [];
  }, [canPickAnyStaff, staff, user]);

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  /** Đổi bộ lọc thì về trang đầu — giữ trang 5 của kết quả cũ là hiện khúc rỗng. */
  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["insurance-list", searchQuery, status, product, from, to, staffId, staffRole, page, dir],
    queryFn: () =>
      fetchInsuranceOrders({
        search: searchQuery,
        status,
        product,
        from,
        to,
        staffId,
        staffRole,
        page,
        sort: "date",
        dir,
      }),
    placeholderData: keepPreviousData,
  });

  const queryClient = useQueryClient();

  /**
   * Nhận đơn từ hàng chờ ngay tại bảng, không phải mở P-14.
   *
   * Hàng chờ làm tay là kho chung và người trực nhặt đơn liên tục — bắt mở
   * từng đơn rồi quay lại là mất chỗ đang cuộn sau mỗi lượt nhặt.
   *
   * KHÔNG đưa "Đánh dấu hoàn thành" ra đây: bước đó đòi ảnh chứng nhận, mà ô
   * đính ảnh nằm ở P-14. Nút ngoài bảng chỉ có thể báo lỗi rồi bảo họ mở đơn.
   */
  const claim = useMutation({
    mutationFn: (row: InsuranceListRow) => setInsuranceOrderStatus(row.id, "manual-progress"),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
      queryClient.invalidateQueries({ queryKey: ["insurance-detail", order.id] });
      toast.ok(`Bạn đang xử lý đơn ${order.orderCode}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không nhận được đơn này.")),
  });

  const remove = useMutation({
    mutationFn: (row: InsuranceListRow) => deleteInsuranceOrder(row.id),
    onSuccess: (_void, row) => {
      queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", row.customerId] });
      // Bảng nhân sự P-51 có cột "Đơn BH" đếm từ chính bảng này — không hỏi lại
      // thì số cũ nằm đó tới khi hết staleTime.
      invalidateKpi(queryClient);
      setRemoving(null);
      // Lùi TRƯỚC khi gọi lại: chỗ này biết trang vừa mất dòng cuối, `RankTable`
      // thì chỉ biết sau khi máy chủ đã trả về một trang rỗng. Bỏ dòng này thì
      // người dùng thấy chữ "Chưa có đơn nào" suốt một lượt gọi mạng.
      setPage((p) => (data.rows.length === 1 && p > 0 ? p - 1 : p));
      toast.ok(`Đã huỷ đơn ${row.orderCode}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không huỷ được đơn này.")),
  });

  const activeCount =
    (status ? 1 : 0) + (product ? 1 : 0) + (from && to ? 1 : 0) + (staffId ? 1 : 0);
  const filtering = Boolean(searchQuery) || activeCount > 0;
  const canEdit = can(user, "insurance", "update");
  const canRemove = can(user, "insurance", "delete");
  const canHandleFallback = can(user, "insurance", "handle-fallback");
  // Bọc `useMemo` vì hàm trả về OBJECT mới mỗi lượt gọi — để trần thì bộ nhớ
  // đệm của `columns` bên dưới hỏng ở mọi lượt render.
  const editVisible = useMemo(() => recordVisibility(user, "insurance", "update"), [user]);
  const removeVisible = useMemo(() => recordVisibility(user, "insurance", "delete"), [user]);

  const columns = useMemo<RankColumn<InsuranceListRow>[]>(
    () => [
      {
        key: "date",
        label: "Ngày tạo đơn",
        sortable: true,
        render: (r) => formatDate(r.orderDate),
      },
      {
        key: "orderCode",
        label: "Mã đơn",
        render: (r) => (
          <Link href={`/insurance/${r.id}`} className={styles.nameLink}>
            {r.orderCode}
          </Link>
        ),
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
      {
        key: "product",
        label: "Loại · gói",
        render: (r) => `${PRODUCT_LABEL[r.product]} · ${r.packageName}`,
      },
      {
        key: "status",
        label: "Trạng thái",
        render: (r) => (
          <StatusTag tone={INSURANCE_STATUS_TONE[r.status]}>
            {INSURANCE_STATUS_LABEL[r.status]}
          </StatusTag>
        ),
      },
      { key: "startDate", label: "Hiệu lực từ", render: (r) => formatDate(r.startDate) },
      { key: "createdByName", label: "Người tạo", render: (r) => r.createdByName ?? "—" },
      ...(canEdit || canRemove || canHandleFallback
        ? [
            {
              key: "actions",
              label: "Thao tác",
              /**
               * Đơn đã hoàn thành KHÔNG hiện nút nào: hợp đồng đã phát hành bên
               * PVI, máy chủ từ chối cả sửa lẫn huỷ. Hiện nút rồi trả lỗi là
               * hứa suông (ảnh chứng nhận vẫn thay được, nhưng ở P-14).
               *
               * Nút chỉ có icon nên `aria-label` phải kèm mã đơn: giữa mười lăm
               * dòng giống nhau, "Sửa" một mình không nói đang sửa dòng nào.
               */
              render: (r: InsuranceListRow) => {
                /**
                 * Hỏi theo TỪNG DÒNG, không chỉ theo module.
                 *
                 * Xem và sửa/huỷ là hai ô quyền rời nhau: nhân viên kinh doanh
                 * xem được đơn cả công ty nhưng chỉ sửa/huỷ đơn mình tạo. Bản
                 * trước chỉ hỏi `can()` nên nút hiện trên mọi dòng, bấm vào thì
                 * máy chủ trả 404 — chặn đúng, nhưng người dùng đã bấm rồi.
                 */
                const mine = {
                  edit: canEdit && recordInScope(editVisible, r),
                  remove: canRemove && recordInScope(removeVisible, r),
                  /* Hàng chờ là KHO CHUNG — ai có `handle-fallback` cũng nhặt
                     được, bất kể phòng. Không kẹp phạm vi, đúng như máy chủ. */
                  claim: canHandleFallback && r.status === "manual-queued",
                };
                if (r.status === "done" || (!mine.edit && !mine.remove && !mine.claim))
                  return <span className="text-muted">—</span>;

                return (
                  <RowActions>
                    {mine.claim && (
                      <Button
                        variant="secondary"
                        icon
                        tooltip="Nhận xử lý"
                        aria-label={`Nhận xử lý đơn ${r.orderCode} của ${r.customerName}`}
                        disabled={claim.isPending}
                        onClick={() => claim.mutate(r)}
                      >
                        <UserCheck size={16} aria-hidden />
                      </Button>
                    )}
                    {mine.edit && (
                      <Button
                        variant="secondary"
                        icon
                        tooltip="Sửa đơn"
                        aria-label={`Sửa đơn ${r.orderCode} của ${r.customerName}`}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil size={16} aria-hidden />
                      </Button>
                    )}
                    {mine.remove && r.source !== "gift" && (
                      <Button
                        variant="secondary"
                        icon
                        tooltip="Huỷ đơn"
                        aria-label={`Huỷ đơn ${r.orderCode} của ${r.customerName}`}
                        onClick={() => setRemoving(r)}
                      >
                        <Trash2 size={16} aria-hidden />
                      </Button>
                    )}
                  </RowActions>
                );
              },
            },
          ]
        : []),
    ],
    [canEdit, canRemove, canHandleFallback, claim, editVisible, removeVisible],
  );

  return (
    <>
      <TopBar title="Bảo hiểm">
        <SearchField
          label="Tìm khách hàng hoặc mã đơn"
          placeholder="Tìm tên khách hoặc mã đơn…"
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
              setStatus("");
              setProduct("");
              setRange(undefined);
              setStaffId("");
              setStaffRole("any");
            })
          }
        >
          <Select
            label="Trạng thái"
            value={status}
            onChange={(v) => refine(() => setStatus(v as InsuranceOrderStatus | ""))}
            options={[
              { value: "", label: "Tất cả trạng thái" },
              ...InsuranceOrderStatus.options.map((s) => ({
                value: s,
                label: INSURANCE_STATUS_LABEL[s],
              })),
            ]}
          />
          <Select
            label="Loại nghiệp vụ"
            value={product}
            onChange={(v) => refine(() => setProduct(v as InsuranceProduct | ""))}
            options={[
              { value: "", label: "Tất cả loại" },
              ...InsuranceProduct.options.map((p) => ({ value: p, label: PRODUCT_LABEL[p] })),
            ]}
          />
          <DateRangePicker value={range} onChange={(v) => refine(() => setRange(v))} />
          <Select
            label="Nhân viên"
            value={staffId}
            onChange={(v) => refine(() => setStaffId(v))}
            options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
          />
          {/* Chỉ hỏi vai khi đã chọn người — "vai nào" không có nghĩa gì khi
              chưa lọc theo ai. */}
          {staffId && (
            <Select
              label="Người đó là"
              value={staffRole}
              onChange={(v) => refine(() => setStaffRole(v as typeof staffRole))}
              options={[
                { value: "any", label: "Người tạo hoặc người xử lý" },
                { value: "creator", label: "Người tạo đơn" },
                { value: "handler", label: "Người xử lý đơn" },
              ]}
            />
          )}
        </FilterButton>
        {can(user, "insurance", "create") && (
          <Button aria-label="Tạo đơn bảo hiểm" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Tạo đơn bảo hiểm</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(status
              ? [
                  {
                    label: `Trạng thái: ${INSURANCE_STATUS_LABEL[status]}`,
                    onRemove: () => refine(() => setStatus("")),
                  },
                ]
              : []),
            ...(product
              ? [
                  {
                    label: `Loại: ${PRODUCT_LABEL[product]}`,
                    onRemove: () => refine(() => setProduct("")),
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
            ...(staffId
              ? [
                  {
                    label: `${
                    staffRole === "creator"
                      ? "Người tạo"
                      : staffRole === "handler"
                        ? "Người xử lý"
                        : "Nhân viên"
                  }: ${staffOptions.find((s) => s.value === staffId)?.label ?? ""}`,
                    onRemove: () =>
                      refine(() => {
                        setStaffId("");
                        setStaffRole("any");
                      }),
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={6} />}
        {isError && (
          <ErrorState what="danh sách đơn bảo hiểm" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <SectionCard
            title="Đơn bảo hiểm"
            icon={<ShieldCheck size={17} />}
            meta={`${data.total} đơn`}
          >
            <RankTable
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort="date"
              caption="Đơn bảo hiểm, mã đơn và trạng thái xử lý"
              emptyText={
                filtering ? "Không có đơn nào khớp bộ lọc." : "Chưa có đơn bảo hiểm nào."
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

        {creating && <CreateInsuranceOrderDialog open onClose={() => setCreating(false)} />}
        {editing && (
          <InsuranceOrderEditDialog open orderId={editing.id} onClose={() => setEditing(null)} />
        )}
        {removing && (
          <ConfirmDialog
            open
            title="Huỷ đơn bảo hiểm này?"
            consequence="Đơn bị xoá hẳn khỏi hệ thống, không có trạng thái “đã huỷ” để tra lại."
            confirmLabel="Huỷ đơn"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(removing)}
            onClose={() => setRemoving(null)}
          >
            <strong>{removing.orderCode}</strong> · {PRODUCT_LABEL[removing.product]} ·{" "}
            {removing.packageName}, của {removing.customerName}, bán ngày{" "}
            {formatDate(removing.orderDate)}.
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import { CreateInsuranceOrderDialog } from "@/components/insurance/CreateInsuranceOrderDialog";
import { fetchInsuranceOrders, type InsuranceListRow } from "@/lib/api/insurance";
import { INSURANCE_STATUS_LABEL, InsuranceOrderStatus } from "@/lib/api/insuranceOrders";
import { formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { availableScopes, can } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/** Đúng hai sản phẩm — spec §3.2 nhấn mạnh không đặt thêm tên khác. */
const PRODUCTS = ["BH tai nạn điện", "BH xe máy"];

/** P-13 · Danh sách đơn bảo hiểm. */
export default function InsurancePage() {
  const user = useSession((s) => s.user);
  const scopes = availableScopes(user, "insurance", "view-detail");
  const scope: Scope = scopes.at(-1) ?? "own";
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [staffId, setStaffId] = useState("");
  const [creating, setCreating] = useState(false);
  const canCreate = can(user, "insurance", "create");

  const iso = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["insurance-list", scope, searchQuery, status, product, from, to, staffId],
    queryFn: () =>
      fetchInsuranceOrders({
        actorId: user?.id ?? "",
        scope,
        search: searchQuery,
        status,
        product,
        from,
        to,
        staffId,
      }),
    placeholderData: (previous) => previous,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const staffOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.createdById) seen.set(r.createdById, r.createdByName ?? r.createdById);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const activeCount =
    (status ? 1 : 0) + (product ? 1 : 0) + (from && to ? 1 : 0) + (staffId ? 1 : 0);

  const columns = useMemo<RankColumn<InsuranceListRow>[]>(
    () => [
      {
        key: "customerName",
        label: "Khách hàng",
        render: (r) => (
          <Link href={`/insurance/${r.id}`} className={styles.nameLink}>
            {r.customerName}
          </Link>
        ),
      },
      { key: "orderCode", label: "Mã đơn", render: (r) => r.orderCode },
      {
        key: "product",
        label: "Loại · gói",
        render: (r) => `${r.product} · ${r.packageName}`,
      },
      {
        key: "status",
        label: "Trạng thái",
        render: (r) => (
          <StatusTag ok={r.status === "done"}>{INSURANCE_STATUS_LABEL[r.status]}</StatusTag>
        ),
      },
      {
        key: "date",
        label: "Ngày",
        sortBy: (r) => new Date(r.date).getTime(),
        render: (r) => formatDate(r.date),
      },
      { key: "createdByName", label: "Người tạo", render: (r) => r.createdByName ?? "—" },
    ],
    [],
  );

  return (
    <>
      <TopBar title="Bảo hiểm">
        <SearchField
          label="Tìm khách hàng"
          placeholder="Tìm tên khách hàng…"
          value={search}
          onChange={setSearch}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() => {
            setStatus("");
            setProduct("");
            setRange(undefined);
            setStaffId("");
          }}
        >
          <Select
            label="Trạng thái"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "Tất cả trạng thái" },
              ...InsuranceOrderStatus.options.map((s) => ({ value: s, label: INSURANCE_STATUS_LABEL[s] })),
            ]}
          />
          <Select
            label="Loại nghiệp vụ"
            value={product}
            onChange={setProduct}
            options={[{ value: "", label: "Tất cả loại" }, ...PRODUCTS.map((p) => ({ value: p, label: p }))]}
          />
          <DateRangePicker value={range} onChange={setRange} />
          <Select
            label="Nhân viên"
            value={staffId}
            onChange={setStaffId}
            options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
          />
        </FilterButton>
        {canCreate && (
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
                    label: `Trạng thái: ${INSURANCE_STATUS_LABEL[status as (typeof InsuranceOrderStatus.options)[number]]}`,
                    onRemove: () => setStatus(""),
                  },
                ]
              : []),
            ...(product ? [{ label: `Loại: ${product}`, onRemove: () => setProduct("") }] : []),
            ...(from && to
              ? [{ label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`, onRemove: () => setRange(undefined) }]
              : []),
            ...(staffId
              ? [
                  {
                    label: `Nhân viên: ${staffOptions.find((s) => s.value === staffId)?.label ?? ""}`,
                    onRemove: () => setStaffId(""),
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={5} />}
        {isError && (
          <ErrorState what="danh sách đơn bảo hiểm" onRetry={refetch} retrying={isFetching} />
        )}

        {data && (
          <SectionCard
            title="Đơn bảo hiểm"
            icon={<ShieldCheck size={17} />}
            meta={`${data.summary.total} đơn`}
          >
            {rows.length === 0 ? (
              <p className="text-muted">Chưa có đơn nào khớp bộ lọc.</p>
            ) : (
              <RankTable
                rows={rows}
                columns={columns}
                rowKey={(r) => r.id}
                defaultSort="date"
                pageSize={20}
                caption="Đơn bảo hiểm, mã đơn và trạng thái xử lý"
              />
            )}
          </SectionCard>
        )}

        {creating && (
          <CreateInsuranceOrderDialog open onClose={() => setCreating(false)} />
        )}
      </main>
    </>
  );
}

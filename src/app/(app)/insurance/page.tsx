"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { ScopeSwitcher } from "@/components/ui/ScopeSwitcher";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchInsuranceOrders, type InsuranceListRow } from "@/lib/api/insurance";
import { INSURANCE_STATUS_LABEL, InsuranceOrderStatus } from "@/lib/api/insuranceOrders";
import { formatDate } from "@/lib/format";
import { availableScopes } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/** Đúng hai sản phẩm — spec §3.2 nhấn mạnh không đặt thêm tên khác. */
const PRODUCTS = ["BH tai nạn điện", "BH xe máy"];

/** P-13 · Danh sách đơn bảo hiểm. */
export default function InsurancePage() {
  const user = useSession((s) => s.user);
  const scopes = availableScopes(user, "insurance", "view-detail");
  const [scope, setScope] = useState<Scope>(scopes.at(-1) ?? "own");
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [staffId, setStaffId] = useState("");

  const iso = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const { data, isPending, isError } = useQuery({
    queryKey: ["insurance-list", scope, status, product, from, to, staffId],
    queryFn: () =>
      fetchInsuranceOrders({
        actorId: user?.id ?? "",
        scope,
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
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
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

        {isPending && <p className="text-muted">Đang tải danh sách…</p>}
        {isError && <p className="text-muted">Không tải được danh sách đơn bảo hiểm.</p>}

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
      </main>
    </>
  );
}

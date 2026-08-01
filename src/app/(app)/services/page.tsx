"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Briefcase, Plus } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { CreateServiceDialog } from "@/components/services/CreateServiceDialog";
import { Button } from "@/components/ui/Button";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { ScopeSwitcher } from "@/components/ui/ScopeSwitcher";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { fetchServices, type ServiceRow } from "@/lib/api/services";
import { fetchServiceTypes } from "@/lib/api/settings";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { formatDate } from "@/lib/format";
import { availableScopes, can } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import type { DateRange } from "react-day-picker";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** P-31 · Danh sách dịch vụ — không có màn chi tiết riêng (không có P-32). */
export default function ServicesPage() {
  const user = useSession((s) => s.user);
  const scopes = availableScopes(user, "services", "view-detail");
  const [scope, setScope] = useState<Scope>(scopes.at(-1) ?? "own");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [ward, setWard] = useState("");
  const [staffId, setStaffId] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["service-types"],
    queryFn: fetchServiceTypes,
  });
  const { data: provinces = [] } = useQuery({ queryKey: ["provinces"], queryFn: fetchProvinces });
  const wards = useMemo(() => provinces.flatMap((p) => p.wards), [provinces]);

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const { data, isPending, isError } = useQuery({
    queryKey: ["services", scope, serviceTypeId, from, to, ward, staffId],
    queryFn: () =>
      fetchServices({
        actorId: user?.id ?? "",
        scope,
        serviceTypeId,
        from,
        to,
        ward,
        staffId,
      }),
    placeholderData: (previous) => previous,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const staffOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.createdById, r.createdByName);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const activeCount =
    (serviceTypeId ? 1 : 0) + (from && to ? 1 : 0) + (ward ? 1 : 0) + (staffId ? 1 : 0);

  const columns = useMemo<RankColumn<ServiceRow>[]>(
    () => [
      { key: "customerName", label: "Khách hàng", render: (r) => r.customerName },
      { key: "serviceTypeName", label: "Loại dịch vụ", render: (r) => r.serviceTypeName },
      { key: "wardName", label: "Xã", render: (r) => r.wardName ?? "—" },
      {
        key: "date",
        label: "Ngày",
        sortBy: (r) => new Date(r.date).getTime(),
        render: (r) => formatDate(r.date),
      },
      { key: "createdByName", label: "Người thực hiện", render: (r) => r.createdByName },
      { key: "note", label: "Ghi chú", render: (r) => r.note || "—" },
    ],
    [],
  );

  return (
    <>
      <TopBar title="Dịch vụ">
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
        <FilterButton
          activeCount={activeCount}
          onClear={() => {
            setServiceTypeId("");
            setRange(undefined);
            setWard("");
            setStaffId("");
          }}
        >
          <Select
            label="Loại dịch vụ"
            value={serviceTypeId}
            onChange={setServiceTypeId}
            options={[
              { value: "", label: "Tất cả loại dịch vụ" },
              ...serviceTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <DateRangePicker value={range} onChange={setRange} />
          <Select
            label="Xã"
            value={ward}
            onChange={setWard}
            options={[
              { value: "", label: "Tất cả xã" },
              ...wards.map((w) => ({ value: w.name, label: w.name })),
            ]}
          />
          <Select
            label="Nhân viên"
            value={staffId}
            onChange={setStaffId}
            options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
          />
        </FilterButton>
        {can(user, "services", "create") && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Ghi dịch vụ
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
                    onRemove: () => setServiceTypeId(""),
                  },
                ]
              : []),
            ...(from && to
              ? [
                  {
                    label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`,
                    onRemove: () => setRange(undefined),
                  },
                ]
              : []),
            ...(ward ? [{ label: `Xã: ${ward}`, onRemove: () => setWard("") }] : []),
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
        {isError && <p className="text-muted">Không tải được danh sách dịch vụ.</p>}

        {data && (
          <SectionCard
            title="Dịch vụ đã thực hiện"
            icon={<Briefcase size={17} />}
            meta={`${data.summary.total} dòng`}
          >
            {rows.length === 0 ? (
              <p className="text-muted">Chưa có dịch vụ nào khớp bộ lọc.</p>
            ) : (
              <RankTable
                rows={rows}
                columns={columns}
                rowKey={(r) => r.id}
                defaultSort="date"
                pageSize={20}
                caption="Dịch vụ đã thực hiện cho khách hàng"
              />
            )}
          </SectionCard>
        )}

        {creating && <CreateServiceDialog open onClose={() => setCreating(false)} />}
      </main>
    </>
  );
}

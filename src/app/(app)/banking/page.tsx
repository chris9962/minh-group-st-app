"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Landmark } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { ScopeSwitcher } from "@/components/ui/ScopeSwitcher";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import { BankAccountStatus } from "@/lib/api/bankAccounts";
import { fetchBankAccounts, type BankAccountRow } from "@/lib/api/banking";
import { fetchBanks, fetchReferralCodes } from "@/lib/api/bankCatalog";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { exportExcel } from "@/lib/excel";
import { formatDate, formatPhone } from "@/lib/format";
import { availableScopes, can } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const STATUS_LABEL: Record<BankAccountStatus, string> = {
  creating: "Đang tạo",
  done: "Hoàn thành",
};

/** Xuất Excel gộp theo khách — mỗi khách một dòng, một cột riêng cho mỗi ngân hàng (spec §8.2). */
function exportByCustomer(rows: BankAccountRow[], bankCodes: string[]) {
  const byCustomer = new Map<string, { customerName: string; createdByNames: Set<string>; cells: Record<string, string> }>();
  for (const r of rows) {
    const row = byCustomer.get(r.customerName) ?? {
      customerName: r.customerName,
      createdByNames: new Set<string>(),
      cells: {},
    };
    row.cells[r.bankCode] = r.accountNumber;
    if (r.createdByName) row.createdByNames.add(r.createdByName);
    byCustomer.set(r.customerName, row);
  }

  return exportExcel({
    fileName: `tai-khoan-ngan-hang-${iso(new Date())}.xlsx`,
    sheetName: "Tài khoản ngân hàng",
    rows: [...byCustomer.values()],
    columns: [
      { header: "Khách hàng", transform: "name", value: (r) => r.customerName },
      { header: "Người tạo", value: (r) => [...r.createdByNames].join(", ") },
      ...bankCodes.map((code) => ({
        header: code,
        type: "text" as const,
        value: (r: { cells: Record<string, string> }) => r.cells[code] ?? "",
      })),
    ],
  });
}

/** P-21 · Danh sách tài khoản ngân hàng. */
export default function BankingPage() {
  const user = useSession((s) => s.user);
  const scopes = availableScopes(user, "banking", "view-detail");
  const [scope, setScope] = useState<Scope>(scopes.at(-1) ?? "own");
  const [bankCode, setBankCode] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [referralCode, setReferralCode] = useState("");
  const [channel, setChannel] = useState("");
  const [staffId, setStaffId] = useState("");
  const [status, setStatus] = useState<BankAccountStatus | "">("");

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const { data: codes = [] } = useQuery({
    queryKey: ["referral-codes", "", ""],
    queryFn: () => fetchReferralCodes({ bankId: "", status: "" }),
  });
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const { data, isPending, isError } = useQuery({
    queryKey: ["bank-account-list", scope, bankCode, from, to, referralCode, channel, staffId, status],
    queryFn: () =>
      fetchBankAccounts({
        actorId: user?.id ?? "",
        scope,
        bankCode,
        from,
        to,
        referralCode,
        channel,
        staffId,
        status,
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
    (bankCode ? 1 : 0) +
    (from && to ? 1 : 0) +
    (referralCode ? 1 : 0) +
    (channel ? 1 : 0) +
    (staffId ? 1 : 0) +
    (status ? 1 : 0);

  const columns = useMemo<RankColumn<BankAccountRow>[]>(
    () => [
      {
        key: "customerName",
        label: "Khách hàng",
        render: (r) => (
          <Link href={`/banking/${r.id}`} className={styles.nameLink}>
            {r.customerName}
          </Link>
        ),
      },
      { key: "bankCode", label: "Ngân hàng", render: (r) => r.bankCode },
      {
        key: "accountNumber",
        label: "STK",
        render: (r) => <span className="tabular-nums">{formatPhone(r.accountNumber)}</span>,
      },
      { key: "referralCode", label: "Mã giới thiệu", render: (r) => r.referralCode },
      {
        key: "status",
        label: "Trạng thái",
        render: (r) => (
          <StatusTag ok={r.status === "done"}>{STATUS_LABEL[r.status]}</StatusTag>
        ),
      },
      {
        key: "appInstalled",
        label: "Đã cài app",
        render: (r) => <StatusTag ok={r.appInstalled}>{r.appInstalled ? "Có" : "Không"}</StatusTag>,
      },
      {
        key: "date",
        label: "Ngày",
        // "" khi tài khoản còn `creating` — chưa mở xong nên chưa có ngày mở thật.
        sortBy: (r) => (r.date ? new Date(r.date).getTime() : 0),
        render: (r) => (r.date ? formatDate(r.date) : "—"),
      },
      { key: "createdByName", label: "Người tạo", render: (r) => r.createdByName ?? "—" },
    ],
    [],
  );

  return (
    <>
      <TopBar title="Ngân hàng">
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
        <FilterButton
          activeCount={activeCount}
          onClear={() => {
            setBankCode("");
            setRange(undefined);
            setReferralCode("");
            setChannel("");
            setStaffId("");
            setStatus("");
          }}
        >
          <Select
            label="Ngân hàng"
            value={bankCode}
            onChange={setBankCode}
            options={[
              { value: "", label: "Tất cả ngân hàng" },
              ...banks.map((b) => ({ value: b.code, label: b.code })),
            ]}
          />
          <Select
            label="Trạng thái"
            value={status}
            onChange={(v) => setStatus(v as BankAccountStatus | "")}
            options={[
              { value: "", label: "Tất cả trạng thái" },
              ...BankAccountStatus.options.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            ]}
          />
          <DateRangePicker value={range} onChange={setRange} />
          <Select
            label="Mã giới thiệu"
            value={referralCode}
            onChange={setReferralCode}
            options={[
              { value: "", label: "Tất cả mã giới thiệu" },
              ...codes.map((c) => ({ value: c.code, label: c.code })),
            ]}
          />
          <Select
            label="Kênh"
            value={channel}
            onChange={setChannel}
            options={[
              { value: "", label: "Tất cả kênh" },
              ...channels.map((c) => ({ value: c.name, label: c.name })),
            ]}
          />
          <Select
            label="Nhân viên"
            value={staffId}
            onChange={setStaffId}
            options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
          />
        </FilterButton>
        {can(user, "banking", "export") && (
          <Button
            variant="secondary"
            onClick={() => exportByCustomer(rows, banks.map((b) => b.code))}
            disabled={rows.length === 0}
          >
            <Download size={16} />
            Xuất Excel
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(bankCode ? [{ label: `Ngân hàng: ${bankCode}`, onRemove: () => setBankCode("") }] : []),
            ...(from && to
              ? [{ label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`, onRemove: () => setRange(undefined) }]
              : []),
            ...(referralCode
              ? [{ label: `Mã giới thiệu: ${referralCode}`, onRemove: () => setReferralCode("") }]
              : []),
            ...(channel ? [{ label: `Kênh: ${channel}`, onRemove: () => setChannel("") }] : []),
            ...(status
              ? [{ label: `Trạng thái: ${STATUS_LABEL[status]}`, onRemove: () => setStatus("") }]
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
        {isError && <p className="text-muted">Không tải được danh sách tài khoản.</p>}

        {data && (
          <SectionCard
            title="Tài khoản ngân hàng"
            icon={<Landmark size={17} />}
            meta={`${data.summary.total} dòng`}
          >
            {rows.length === 0 ? (
              <p className="text-muted">Chưa có tài khoản nào khớp bộ lọc.</p>
            ) : (
              <RankTable
                rows={rows}
                columns={columns}
                rowKey={(r) => r.id}
                defaultSort="date"
                pageSize={20}
                caption="Tài khoản ngân hàng đã mở cho khách hàng"
              />
            )}
          </SectionCard>
        )}
      </main>
    </>
  );
}

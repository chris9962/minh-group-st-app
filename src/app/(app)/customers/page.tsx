"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Briefcase, Gift, Landmark, Plus, Users } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountFormDialog } from "@/components/banking/BankAccountFormDialog";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { GiftGivingDialog } from "@/components/customers/GiftGivingDialog";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
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
import { fetchChannels } from "@/lib/api/channelCatalog";
import { fetchCustomers, type CustomerRow } from "@/lib/api/customers";
import { formatDate, formatPhone } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const GIFT_STATUS_LABEL: Record<CustomerRow["giftStatus"], string> = {
  none: "Chưa đủ điều kiện",
  eligible: "Đủ ĐK · chưa phát",
  given: "Đã tặng",
};

/** P-40 · Danh sách khách hàng — không áp phạm vi, ai đăng nhập cũng thấy hết. */
export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [channel, setChannel] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [givingGiftTo, setGivingGiftTo] = useState<CustomerRow | null>(null);
  const [openingBankFor, setOpeningBankFor] = useState<CustomerRow | null>(null);
  const [loggingServiceFor, setLoggingServiceFor] = useState<CustomerRow | null>(null);

  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";
  const activeCount = (channel ? 1 : 0) + (from && to ? 1 : 0);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["customers", searchQuery, channel, from, to],
    queryFn: () => fetchCustomers({ search: searchQuery, channel, from, to }),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<RankColumn<CustomerRow>[]>(
    () => [
      {
        key: "fullName",
        label: "Tên khách hàng",
        render: (c) => (
          <Link href={`/customers/${c.id}`} className={styles.nameLink}>
            {c.fullName}
          </Link>
        ),
      },
      {
        key: "primaryPhone",
        label: "SĐT chính",
        render: (c) => <span className="tabular-nums">{formatPhone(c.primaryPhone)}</span>,
      },
      {
        key: "accountCount",
        label: "Số tài khoản",
        sortBy: (c) => c.accountCount,
        render: (c) => c.accountCount,
      },
      {
        key: "insuranceCount",
        label: "Số đơn BH",
        sortBy: (c) => c.insuranceCount,
        render: (c) => c.insuranceCount,
      },
      {
        key: "channel",
        label: "Kênh",
        render: (c) => c.channel || "—",
      },
      {
        key: "createdAt",
        label: "Ngày tạo",
        sortBy: (c) => Number(c.createdAt.replace(/-/g, "")),
        render: (c) => formatDate(c.createdAt),
      },
      {
        key: "giftStatus",
        label: "Trạng thái quà",
        render: (c) => (
          <StatusTag ok={c.giftStatus !== "eligible"}>
            {c.giftStatus === "given" && c.givenItem
              ? `Đã tặng · ${c.givenItem}`
              : GIFT_STATUS_LABEL[c.giftStatus]}
          </StatusTag>
        ),
      },
      {
        key: "actions",
        label: "Thao tác",
        render: (c) => (
          <span className={styles.actions}>
            <Button
              variant="secondary"
              disabled={c.giftStatus === "given"}
              onClick={() => setGivingGiftTo(c)}
            >
              <Gift size={16} />
              Tặng quà
            </Button>
            <Button variant="secondary" onClick={() => setOpeningBankFor(c)}>
              <Landmark size={16} />
              Mở ngân hàng
            </Button>
            <Button variant="secondary" onClick={() => setLoggingServiceFor(c)}>
              <Briefcase size={16} />
              Ghi dịch vụ
            </Button>
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <TopBar title="Khách hàng">
        <SearchField
          label="Tìm khách hàng"
          placeholder="Tên, SĐT, hoặc 4 số cuối CCCD…"
          value={search}
          onChange={setSearch}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() => {
            setChannel("");
            setRange(undefined);
          }}
        >
          <Select
            label="Kênh"
            value={channel}
            onChange={setChannel}
            options={[
              { value: "", label: "Tất cả kênh" },
              ...channels.map((c) => ({ value: c.name, label: c.name })),
            ]}
          />
          <DateRangePicker value={range} onChange={setRange} />
        </FilterButton>
        <Button aria-label="Thêm khách hàng" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden />
          <span className={buttonStyles.label}>Thêm khách hàng</span>
        </Button>
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(channel ? [{ label: `Kênh: ${channel}`, onRemove: () => setChannel("") }] : []),
            ...(from && to
              ? [{ label: `Ngày tạo: ${formatDate(from)} → ${formatDate(to)}`, onRemove: () => setRange(undefined) }]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={5} />}
        {isError && (
          <ErrorState what="danh sách khách hàng" onRetry={refetch} retrying={isFetching} />
        )}

        {data && (
          <SectionCard
            title="Khách hàng"
            icon={<Users size={17} />}
            meta={
              searchQuery || activeCount > 0
                ? `khớp ${data.customers.length}/${data.summary.total}`
                : `${data.summary.total} khách`
            }
          >
            {data.customers.length === 0 && (
              <p className="text-muted">
                {searchQuery
                  ? `Không tìm thấy khách nào khớp "${searchQuery}".`
                  : activeCount > 0
                    ? "Không có khách nào khớp bộ lọc."
                    : "Chưa có khách hàng nào."}
              </p>
            )}

            <RankTable
              rows={data.customers}
              columns={columns}
              rowKey={(c) => c.id}
              defaultSort="accountCount"
              pageSize={15}
              caption="Khách hàng, số tài khoản, số đơn bảo hiểm và trạng thái quà"
            />

            <p className={styles.footnote}>
              Hồ sơ khách <strong>ai cũng xem được</strong>, không phân biệt
              phòng — chỉ tài khoản/đơn bảo hiểm bên trong mới theo phạm vi
              được cấp.
            </p>
          </SectionCard>
        )}

        {creating && <CustomerFormDialog open onClose={() => setCreating(false)} />}

        {givingGiftTo && (
          <GiftGivingDialog
            open
            customerId={givingGiftTo.id}
            customerName={givingGiftTo.fullName}
            onClose={() => setGivingGiftTo(null)}
          />
        )}

        {openingBankFor && (
          <BankAccountFormDialog
            open
            customerId={openingBankFor.id}
            customerPrimaryPhone={openingBankFor.primaryPhone}
            onClose={() => setOpeningBankFor(null)}
          />
        )}

        {loggingServiceFor && (
          <ServiceFormDialog
            open
            customerId={loggingServiceFor.id}
            customerName={loggingServiceFor.fullName}
            onClose={() => setLoggingServiceFor(null)}
          />
        )}
      </main>
    </>
  );
}

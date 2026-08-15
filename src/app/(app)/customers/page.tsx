"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { fetchChannels } from "@/lib/api/channelCatalog";
import { fetchCustomers, type CustomerQuery, type CustomerRow } from "@/lib/api/customers";
import { EMPTY_PAGE, PAGE_SIZE } from "@/lib/api/pagination";
import { formatDate, formatPhone } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Khách mới nhất lên đầu — người nhập vừa tạo xong là thấy ngay dòng của mình. */
const FIRST_PAGE: CustomerQuery = {
  search: "",
  channelId: "",
  from: "",
  to: "",
  page: 0,
  sort: "created",
  dir: "desc",
};

/**
 * P-40 · Danh sách khách hàng — không áp phạm vi, ai đăng nhập cũng thấy hết.
 *
 * Tìm, lọc, sắp và cắt trang đều do máy chủ làm (AGENTS.md §5.1). Màn này chỉ
 * giữ CÂU HỎI trong `query` rồi hiện đúng những gì máy chủ trả về — không có
 * chỗ nào lọc lại hay sắp lại trên dữ liệu đã tải.
 */
export default function CustomersPage() {
  const user = useSession((s) => s.user);
  const [query, setQuery] = useState<CustomerQuery>(FIRST_PAGE);
  const [creating, setCreating] = useState(false);
  const [givingGiftTo, setGivingGiftTo] = useState<CustomerRow | null>(null);
  const [openingBankFor, setOpeningBankFor] = useState<CustomerRow | null>(null);
  const [loggingServiceFor, setLoggingServiceFor] = useState<CustomerRow | null>(null);

  // Ô tìm giữ chữ đang gõ riêng, chỉ hoãn xong mới thành câu hỏi gửi đi — nối
  // thẳng vào `query` thì mỗi phím là một lượt gọi máy chủ.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [range, setRange] = useState<DateRange | undefined>(undefined);

  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";
  const asked: CustomerQuery = { ...query, search: debouncedSearch, from, to };

  const { data: page = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["customers", asked],
    queryFn: () => fetchCustomers(asked),
    // Giữ trang cũ trong lúc tải trang mới: không giữ thì bảng bị thay bằng
    // skeleton mỗi lần gõ, nút "Sau" rời khỏi DOM và người dùng bàn phím mất
    // tiêu điểm giữa chừng (AGENTS.md §8).
    placeholderData: keepPreviousData,
  });

  /** Đổi bộ lọc thì về trang đầu — giữ nguyên trang 5 của kết quả cũ là hiện một khúc rỗng. */
  const refine = (patch: Partial<CustomerQuery>) => setQuery((q) => ({ ...q, ...patch, page: 0 }));

  const activeCount = (query.channelId ? 1 : 0) + (from && to ? 1 : 0);
  // "Chưa có khách nào" và "lọc không ra gì" là hai chuyện khác nhau. Nói nhầm
  // thì người dùng đi xoá bộ lọc vốn đang trống, thay vì bấm "Thêm khách hàng".
  const filtering = Boolean(debouncedSearch) || activeCount > 0;

  const columns = useMemo<RankColumn<CustomerRow>[]>(
    () => [
      {
        key: "name",
        label: "Tên khách hàng",
        sortable: true,
        render: (c) => (
          <Link href={`/customers/${c.id}`} className={styles.nameLink}>
            {c.fullName}
          </Link>
        ),
      },
      {
        key: "created",
        label: "Ngày tạo",
        sortable: true,
        render: (c) => <span className="tabular-nums">{formatDate(c.createdAt)}</span>,
      },
      {
        key: "accounts",
        label: "Số tài khoản",
        sortable: true,
        render: (c) => <span className="tabular-nums">{c.accountCount}</span>,
      },
      {
        key: "insurance",
        label: "Số đơn BH",
        sortable: true,
        render: (c) => <span className="tabular-nums">{c.insuranceCount}</span>,
      },
      {
        key: "channel",
        label: "Kênh",
        render: (c) => c.channel || "",
      },
      {
        key: "createdByName",
        label: "Người tạo",
        render: (c) => c.createdByName || "",
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
          onChange={(v) => {
            // Về trang đầu ngay lúc gõ, không đợi hoãn xong: đang ở trang 3 mà
            // kết quả mới chỉ có 2 dòng thì trang 3 là một khúc rỗng.
            setSearch(v);
            setQuery((q) => ({ ...q, page: 0 }));
          }}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() => {
            setRange(undefined);
            refine({ channelId: "" });
          }}
        >
          <Select
            label="Kênh"
            value={query.channelId}
            onChange={(v) => refine({ channelId: v })}
            options={[
              { value: "", label: "Tất cả kênh" },
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <DateRangePicker
            value={range}
            onChange={(next) => {
              setRange(next);
              setQuery((q) => ({ ...q, page: 0 }));
            }}
          />
        </FilterButton>
        {can(user, "customer", "create") && (
          <Button aria-label="Thêm khách hàng" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Thêm khách hàng</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(query.channelId
              ? [
                  {
                    label: `Kênh: ${channels.find((c) => c.id === query.channelId)?.name ?? query.channelId}`,
                    onRemove: () => refine({ channelId: "" }),
                  },
                ]
              : []),
            ...(from && to
              ? [
                  {
                    label: `Ngày tạo: ${formatDate(from)} → ${formatDate(to)}`,
                    onRemove: () => {
                      setRange(undefined);
                      setQuery((q) => ({ ...q, page: 0 }));
                    },
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={8} />}
        {isError && (
          <ErrorState what="danh sách khách hàng" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <SectionCard
            title="Khách hàng"
            icon={<Users size={17} />}
            meta={filtering ? `khớp ${page.total}` : `${page.total} khách`}
          >
            {page.total === 0 ? (
              <p className="text-muted">
                {debouncedSearch
                  ? `Không tìm thấy khách nào khớp “${debouncedSearch}”.`
                  : filtering
                    ? "Không có khách nào khớp bộ lọc."
                    : "Chưa có khách hàng nào."}
              </p>
            ) : (
              <RankTable
                rows={page.rows}
                columns={columns}
                rowKey={(c) => c.id}
                defaultSort="created"
                caption="Khách hàng, số tài khoản, số đơn bảo hiểm và trạng thái quà"
                server={{
                  sort: query.sort,
                  dir: query.dir,
                  page: query.page,
                  total: page.total,
                  pageSize: PAGE_SIZE,
                  onSortChange: (sort, dir) =>
                    refine({ sort: sort as CustomerQuery["sort"], dir }),
                  onPageChange: (next) => setQuery((q) => ({ ...q, page: next })),
                }}
              />
            )}
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

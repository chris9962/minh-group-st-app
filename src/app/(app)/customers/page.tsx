"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Users } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchCustomers, type CustomerRow } from "@/lib/api/customers";
import { formatPhone } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import styles from "./page.module.scss";

const GIFT_STATUS_LABEL: Record<CustomerRow["giftStatus"], string> = {
  none: "Chưa đủ điều kiện",
  eligible: "Đủ ĐK · chưa phát",
  given: "Đã tặng",
};

/** P-40 · Danh sách khách hàng — không áp phạm vi, ai đăng nhập cũng thấy hết. */
export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ["customers", searchQuery],
    queryFn: () => fetchCustomers(searchQuery),
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
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} />
          Thêm khách hàng
        </Button>
      </TopBar>

      <main className={styles.body}>
        {isPending && <p className="text-muted">Đang tải danh sách…</p>}
        {isError && <p className="text-muted">Không tải được danh sách khách hàng.</p>}

        {data && (
          <SectionCard
            title="Khách hàng"
            icon={<Users size={17} />}
            meta={
              searchQuery
                ? `khớp ${data.customers.length}/${data.summary.total}`
                : `${data.summary.total} khách`
            }
          >
            {data.customers.length === 0 && (
              <p className="text-muted">
                {searchQuery
                  ? `Không tìm thấy khách nào khớp "${searchQuery}".`
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
      </main>
    </>
  );
}

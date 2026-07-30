"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { ChevronLeft, Gift, Landmark, ShieldCheck, User as UserIcon } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchCustomerDetail,
  type CustomerAccountRow,
  type CustomerInsuranceRow,
} from "@/lib/api/customers";
import { INSURANCE_STATUS_LABEL } from "@/lib/api/insuranceOrders";
import { formatDate, formatIdNumber, formatPhone, formatVnd } from "@/lib/format";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const INSURANCE_SOURCE_LABEL: Record<CustomerInsuranceRow["source"], string> = {
  self: "Tự mua",
  gift: "Quà tặng",
};

/** P-42 · Hồ sơ khách hàng 360°. */
export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const actor = useSession((s) => s.user);
  const [editing, setEditing] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => fetchCustomerDetail(id, actor?.id ?? ""),
  });

  const accountColumns: RankColumn<CustomerAccountRow>[] = [
    { key: "date", label: "Ngày mở", sortBy: (a) => Number(a.date.replace(/-/g, "")), render: (a) => formatDate(a.date) },
    { key: "bankName", label: "Ngân hàng", render: (a) => a.bankName },
    { key: "referralCode", label: "Mã giới thiệu", render: (a) => a.referralCode },
    {
      key: "appInstalled",
      label: "Đã cài app",
      render: (a) => <StatusTag ok={a.appInstalled}>{a.appInstalled ? "Có" : "Chưa"}</StatusTag>,
    },
  ];

  const insuranceColumns: RankColumn<CustomerInsuranceRow>[] = [
    { key: "date", label: "Ngày tạo", sortBy: (i) => Number(i.date.replace(/-/g, "")), render: (i) => formatDate(i.date) },
    { key: "product", label: "Sản phẩm", render: (i) => `${i.product} · ${i.packageName}` },
    { key: "source", label: "Nguồn", render: (i) => INSURANCE_SOURCE_LABEL[i.source] },
    {
      key: "status",
      label: "Trạng thái",
      render: (i) => (
        <StatusTag ok={i.status === "done"}>{INSURANCE_STATUS_LABEL[i.status]}</StatusTag>
      ),
    },
  ];

  return (
    <>
      <TopBar title={data?.customer.fullName ?? "Khách hàng"} />

      <main className={styles.body}>
        <Link href="/customers" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Khách hàng
        </Link>

        {isPending && <p className="text-muted">Đang tải hồ sơ khách hàng…</p>}
        {isError && <p className="text-muted">Không tải được hồ sơ khách hàng này.</p>}

        {data && (
          <>
            <SectionCard title="Thông tin" icon={<UserIcon size={17} />}>
              <dl className={styles.info}>
                <div>
                  <dt>Ngày sinh</dt>
                  <dd>{data.customer.dob ? formatDate(data.customer.dob) : "Chưa có"}</dd>
                </div>
                <div>
                  <dt>CCCD</dt>
                  <dd>
                    {data.customer.idNumber ? formatIdNumber(data.customer.idNumber) : "Chưa có"}
                  </dd>
                </div>
                <div>
                  <dt>Địa chỉ</dt>
                  <dd>{data.customer.address || "Chưa có"}</dd>
                </div>
                <div>
                  <dt>Điện thoại</dt>
                  <dd>
                    {data.customer.phones.map((p) => (
                      <span key={p.id} className={styles.phone}>
                        <span className="tabular-nums">{formatPhone(p.number)}</span>
                        {p.primary && <span className={styles.primaryTag}>Số chính</span>}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
              <div className={styles.footRow}>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Sửa thông tin
                </Button>
              </div>
            </SectionCard>

            <SectionCard
              title="Tài khoản ngân hàng"
              icon={<Landmark size={17} />}
              meta={`${data.accounts.length} tài khoản`}
            >
              {data.accounts.length === 0 ? (
                <p className="text-muted">Chưa có tài khoản ngân hàng nào trong phạm vi xem.</p>
              ) : (
                <RankTable
                  rows={data.accounts}
                  columns={accountColumns}
                  rowKey={(a) => a.id}
                  defaultSort="date"
                  pageSize={10}
                  caption="Tài khoản ngân hàng của khách"
                />
              )}
              {data.accountsHiddenCount > 0 && (
                <p className={styles.footnote}>
                  Còn <strong>{data.accountsHiddenCount}</strong> tài khoản của phòng khác,
                  ngoài phạm vi xem của bạn.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Đơn bảo hiểm"
              icon={<ShieldCheck size={17} />}
              meta={`${data.insurance.length} đơn`}
            >
              {data.insurance.length === 0 ? (
                <p className="text-muted">Chưa có đơn bảo hiểm nào trong phạm vi xem.</p>
              ) : (
                <RankTable
                  rows={data.insurance}
                  columns={insuranceColumns}
                  rowKey={(i) => i.id}
                  defaultSort="date"
                  pageSize={10}
                  caption="Đơn bảo hiểm của khách"
                />
              )}
              {data.insuranceHiddenCount > 0 && (
                <p className={styles.footnote}>
                  Còn <strong>{data.insuranceHiddenCount}</strong> đơn của phòng khác, ngoài
                  phạm vi xem của bạn.
                </p>
              )}
            </SectionCard>

            <SectionCard title="Quà" icon={<Gift size={17} />}>
              <dl className={styles.giftInfo}>
                <div>
                  <dt>Tiền mặt</dt>
                  <dd>
                    <span className="tabular-nums">{formatVnd(data.gift.cashTotal)}</span>
                    {data.gift.cashBreakdown.length > 0 && (
                      <span className={styles.detail}>
                        {data.gift.cashBreakdown
                          .map((b) => `${formatVnd(b.amount)} (${b.label})`)
                          .join(" + ")}
                      </span>
                    )}
                  </dd>
                </div>
                {!data.gift.given && (
                  <div>
                    <dt>Rổ quà</dt>
                    <dd>
                      {data.gift.basket.length === 0 ? (
                        "Chưa đủ điều kiện"
                      ) : (
                        <ol className={styles.basket}>
                          {data.gift.basket.map((item, i) => (
                            <li key={`${item.id}-${i}`}>{item.name}</li>
                          ))}
                        </ol>
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Trạng thái</dt>
                  <dd>
                    <StatusTag ok={data.gift.given || data.gift.basket.length === 0}>
                      {data.gift.given
                        ? "Đã tặng"
                        : data.gift.basket.length > 0
                          ? "Đủ ĐK · chưa phát"
                          : "Chưa đủ điều kiện"}
                    </StatusTag>
                    {data.gift.given && data.gift.givenItem && (
                      <span className={styles.detail}>Đã giao: {data.gift.givenItem}</span>
                    )}
                  </dd>
                </div>
              </dl>
              <p className={styles.footnote}>
                Quà tính trên <strong>toàn bộ</strong> tài khoản của khách, kể cả tài khoản
                ngoài phạm vi xem của bạn. Luồng <strong>Tặng quà</strong> (P-43 — chọn món,
                tạo đơn thụ hưởng, đánh dấu đã giao) chưa triển khai; màn này mới dừng ở tính
                toán hiển thị.
              </p>
            </SectionCard>
          </>
        )}

        {editing && data && (
          <CustomerFormDialog open customer={data.customer} onClose={() => setEditing(false)} />
        )}
      </main>
    </>
  );
}

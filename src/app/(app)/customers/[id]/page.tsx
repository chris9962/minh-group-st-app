"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { Briefcase, ChevronLeft, Gift, Landmark, ShieldCheck, Trash2, User as UserIcon } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountFormDialog } from "@/components/banking/BankAccountFormDialog";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { GiftGivingDialog } from "@/components/customers/GiftGivingDialog";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { deleteBankAccount } from "@/lib/api/bankAccounts";
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
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [givingGift, setGivingGift] = useState(false);
  const [openingBank, setOpeningBank] = useState(false);
  const [loggingService, setLoggingService] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => fetchCustomerDetail(id, actor?.id ?? ""),
  });

  const removeDraft = useMutation({
    mutationFn: (accountId: string) => deleteBankAccount(accountId, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      // Xoá nhả chỗ mã ngay — không invalidate thì hộp thoại "Mở ngân hàng"
      // vẫn hiện "đang giữ" cũ tới khi hết 30s staleTime mặc định.
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    },
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
                  <dt>Kênh</dt>
                  <dd>
                    {data.customer.channel || "Không có"}
                    {data.customer.channelDetail ? ` · ${data.customer.channelDetail}` : ""}
                  </dd>
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
                <Button
                  variant="secondary"
                  disabled={data.gift.given}
                  onClick={() => setGivingGift(true)}
                >
                  <Gift size={16} />
                  Tặng quà
                </Button>
                <Button variant="secondary" onClick={() => setOpeningBank(true)}>
                  <Landmark size={16} />
                  Mở ngân hàng
                </Button>
                <Button variant="secondary" onClick={() => setLoggingService(true)}>
                  <Briefcase size={16} />
                  Ghi dịch vụ
                </Button>
              </div>
            </SectionCard>

            <SectionCard
              title="Tài khoản ngân hàng"
              icon={<Landmark size={17} />}
              meta={`${data.accounts.length} tài khoản`}
            >
              {data.draftAccounts.length > 0 && (
                <ul className={styles.drafts}>
                  {data.draftAccounts.map((a) => (
                    <li key={a.id} className={styles.draftRow}>
                      <span>
                        <strong>{a.bankName}</strong> · {a.referralCode} — đang tạo, chưa hoàn thành
                      </span>
                      <span className={styles.draftActions}>
                        <Link href={`/banking/${a.id}`} className="btn btn-secondary">
                          Tiếp tục
                        </Link>
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`Xoá tài khoản đang tạo ${a.bankName}`}
                          disabled={removeDraft.isPending}
                          onClick={() => removeDraft.mutate(a.id)}
                        >
                          <Trash2 size={16} aria-hidden />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {data.draftAccountsHiddenCount > 0 && (
                <p className={styles.footnote}>
                  Còn <strong>{data.draftAccountsHiddenCount}</strong> tài khoản đang tạo của
                  phòng khác, ngoài phạm vi xem của bạn.
                </p>
              )}

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
                ngoài phạm vi xem của bạn.
              </p>
            </SectionCard>
          </>
        )}

        {editing && data && (
          <CustomerFormDialog open customer={data.customer} onClose={() => setEditing(false)} />
        )}

        {givingGift && data && (
          <GiftGivingDialog
            open
            customerId={data.customer.id}
            customerName={data.customer.fullName}
            onClose={() => setGivingGift(false)}
          />
        )}

        {openingBank && data && (
          <BankAccountFormDialog
            open
            customerId={data.customer.id}
            customerPrimaryPhone={
              data.customer.phones.find((p) => p.primary)?.number ?? data.customer.phones[0]?.number ?? ""
            }
            onClose={() => setOpeningBank(false)}
          />
        )}

        {loggingService && data && (
          <ServiceFormDialog
            open
            customerId={data.customer.id}
            customerName={data.customer.fullName}
            onClose={() => setLoggingService(false)}
          />
        )}
      </main>
    </>
  );
}

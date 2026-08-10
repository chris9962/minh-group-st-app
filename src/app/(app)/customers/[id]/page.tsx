"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { Briefcase, ChevronLeft, Gift, Landmark, ShieldCheck, Trash2, User as UserIcon } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
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
  type CustomerServiceRow,
} from "@/lib/api/customers";
import { INSURANCE_STATUS_LABEL } from "@/lib/api/insuranceOrders";
import { formatDate, formatIdNumber, formatPhone, formatVnd } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import { errorMessage, toast } from "@/lib/toast";
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

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => fetchCustomerDetail(id),
  });

  const removeDraft = useMutation({
    mutationFn: (accountId: string) => deleteBankAccount(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      // Xoá nhả chỗ mã ngay — không invalidate thì hộp thoại "Mở ngân hàng"
      // vẫn hiện "đang giữ" cũ tới khi hết 30s staleTime mặc định.
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      toast.ok("Đã xoá tài khoản đang tạo dở, mã giới thiệu được nhả lại");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được tài khoản này.")),
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

  const serviceColumns: RankColumn<CustomerServiceRow>[] = [
    {
      key: "date",
      label: "Ngày",
      sortBy: (s) => Number(s.date.replace(/-/g, "")),
      render: (s) => formatDate(s.date),
    },
    { key: "serviceTypeName", label: "Loại dịch vụ", render: (s) => s.serviceTypeName },
    { key: "createdByName", label: "Người thực hiện", render: (s) => s.createdByName },
    { key: "note", label: "Ghi chú", render: (s) => s.note || "—" },
  ];

  return (
    <>
      <TopBar title={data?.customer.fullName ?? "Khách hàng"} />

      <main className={styles.body}>
        <Link href="/customers" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Khách hàng
        </Link>

        {isPending && <SkeletonCard lines={5} />}
        {isError && (
          <ErrorState what="hồ sơ khách hàng này" onRetry={refetch} retrying={isFetching} />
        )}

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
                    {/* Che thì KHÔNG đưa qua `formatIdNumber` — hàm đó chia nhóm
                        theo 12 số, đưa 4 số vào ra một chuỗi trông như CCCD thật
                        mà ngắn ngủn. */}
                    {!data.customer.idNumber
                      ? "Chưa có"
                      : data.customer.idNumberMasked
                        ? `•••• •••• ${data.customer.idNumber}`
                        : formatIdNumber(data.customer.idNumber)}
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
                {/* Ẩn nút khi máy chủ sẽ từ chối — bấm xong nhận 403 thì câu báo
                    lỗi không nói được là "vai của bạn vốn không sửa hồ sơ
                    khách". Điều kiện phải khớp đúng chốt ở `PATCH /api/customers/[id]`. */}
                {can(actor, "customer", "update") && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Sửa thông tin
                  </Button>
                )}
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

            <SectionCard
              title="Dịch vụ đã làm"
              icon={<Briefcase size={17} />}
              meta={`${data.services.length} lượt`}
            >
              {data.services.length === 0 ? (
                <p className="text-muted">Chưa hỗ trợ dịch vụ nào trong phạm vi xem.</p>
              ) : (
                <RankTable
                  rows={data.services}
                  columns={serviceColumns}
                  rowKey={(s) => s.id}
                  defaultSort="date"
                  pageSize={10}
                  caption="Dịch vụ đã thực hiện cho khách"
                />
              )}
              {data.servicesHiddenCount > 0 && (
                <p className={styles.footnote}>
                  Còn <strong>{data.servicesHiddenCount}</strong> lượt của phòng khác, ngoài
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
                {data.gift.insuranceYears > 0 && (
                  <div>
                    <dt>Bảo hiểm</dt>
                    <dd>
                      {data.gift.insuranceYears} năm
                      {data.gift.caseCode && (
                        <span className={styles.detail}>Trường hợp {data.gift.caseCode}</span>
                      )}
                    </dd>
                  </div>
                )}
                {!data.gift.given && (
                  <div>
                    <dt>Rổ quà</dt>
                    <dd>
                      {/* Rổ rỗng có HAI lý do khác hẳn nhau: khách chưa đủ
                          combo, hoặc đủ rồi mà admin vừa tắt hết món trong danh
                          mục. Nói gộp thì nhân viên đi tư vấn khách mở thêm tài
                          khoản trong khi lỗi nằm ở màn danh mục. */}
                      {data.gift.basket.length === 0 ? (
                        data.gift.caseCode ? (
                          <span className="text-muted">
                            Đủ điều kiện nhưng danh mục chưa có món nào phát được — xem lại
                            danh mục quà và gói bảo hiểm.
                          </span>
                        ) : (
                          "Chưa đủ điều kiện"
                        )
                      ) : (
                        <ol className={styles.basket}>
                          {data.gift.basket.map((item, i) => (
                            <li key={`${item.code}-${i}`}>
                              {item.name}
                              {/* Khách vẫn đủ điều kiện nhận — chỉ là không phát
                                  được lúc này. Bỏ dòng đi thì rổ hụt món mà
                                  không ai biết vì sao. */}
                              {item.status !== "ok" && (
                                <span className={styles.basketOff}>
                                  {item.status === "discontinued"
                                    ? " (đã ngưng cấp)"
                                    : " (không còn trong danh mục)"}
                                </span>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Trạng thái</dt>
                  <dd>
                    {/* Ba trạng thái, ba tông. Đọc theo `caseCode` chứ không
                        theo số món trong rổ: rổ có thể rỗng vì admin vừa tắt
                        mấy món trong danh mục, mà khách thì vẫn đủ điều kiện. */}
                    <StatusTag ok={data.gift.given ? true : data.gift.caseCode ? false : null}>
                      {data.gift.given
                        ? "Đã tặng"
                        : data.gift.caseCode
                          ? "Đủ ĐK · chưa phát"
                          : "Chưa đủ điều kiện"}
                    </StatusTag>
                    {data.gift.given && data.gift.givenItem && (
                      <span className={styles.detail}>Đã giao: {data.gift.givenItem}</span>
                    )}
                  </dd>
                </div>
              </dl>
              {/* Lý do phải hiện ngay tại màn, không giấu sau nút: khách đứng đó
                  hỏi "sao tôi chỉ được 1 năm" thì nhân viên đọc thẳng ra. */}
              {data.gift.explain.length > 0 && (
                <ul className={styles.giftExplain}>
                  {data.gift.explain.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
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

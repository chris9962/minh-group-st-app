"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";
import { CheckCircle2, ChevronLeft, Download, ShieldCheck } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchInsuranceDetail } from "@/lib/api/insurance";
import { INSURANCE_STATUS_LABEL, setInsuranceOrderStatus } from "@/lib/api/insuranceOrders";
import { formatDate, formatIdNumber, formatPhone } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const SOURCE_LABEL = { self: "Tự mua", gift: "Quà tặng" } as const;

/** Tải bản tóm tắt đơn — không có PDF thật trong hệ thống mô phỏng này. */
function downloadSummary(data: {
  orderCode: string;
  customerName: string;
  product: string;
  packageName: string;
  beneficiaryName: string;
}) {
  const text = [
    `Mã đơn: ${data.orderCode}`,
    `Khách hàng: ${data.customerName}`,
    `Sản phẩm: ${data.product} · ${data.packageName}`,
    `Người thụ hưởng: ${data.beneficiaryName}`,
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.orderCode}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** P-14 · Chi tiết đơn bảo hiểm — chỉ xem, không có nút sửa/huỷ sau khi đơn đã chạy. */
export default function InsuranceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ["insurance-detail", id],
    queryFn: () => fetchInsuranceDetail(id, actor?.id ?? ""),
  });

  const advance = useMutation({
    mutationFn: (status: "manual-progress" | "done") =>
      setInsuranceOrderStatus(id, status, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
    },
  });

  const canHandleFallback = can(actor, "insurance", "handle-fallback");

  return (
    <>
      <TopBar title={data ? `${data.orderCode} · ${data.customerName}` : "Đơn bảo hiểm"} />

      <main className={styles.body}>
        <Link href="/insurance" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Bảo hiểm
        </Link>

        {isPending && <p className="text-muted">Đang tải đơn…</p>}
        {isError && <p className="text-muted">Không tìm thấy đơn này.</p>}

        {data && (
          <SectionCard
            title="Chi tiết đơn bảo hiểm"
            icon={<ShieldCheck size={17} />}
            meta={INSURANCE_STATUS_LABEL[data.status]}
          >
            <dl className={styles.fields}>
              <div>
                <dt>Khách hàng</dt>
                <dd>
                  {data.customerId ? (
                    <Link href={`/customers/${data.customerId}`} className={styles.customerLink}>
                      {data.customerName}
                    </Link>
                  ) : (
                    data.customerName
                  )}
                </dd>
              </div>
              <div>
                <dt>Mã đơn</dt>
                <dd>{data.orderCode}</dd>
              </div>
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusTag ok={data.status === "done"}>{INSURANCE_STATUS_LABEL[data.status]}</StatusTag>
                </dd>
              </div>
              <div>
                <dt>Sản phẩm</dt>
                <dd>{data.product}</dd>
              </div>
              <div>
                <dt>Gói</dt>
                <dd>{data.packageName}</dd>
              </div>
              <div>
                <dt>Ngày tạo</dt>
                <dd>{formatDate(data.date)}</dd>
              </div>
              <div>
                <dt>Nguồn gốc</dt>
                <dd>{SOURCE_LABEL[data.source]}</dd>
              </div>
              <div>
                <dt>Người thụ hưởng</dt>
                <dd>{data.beneficiaryName}</dd>
              </div>
              <div>
                <dt>Ngày sinh</dt>
                <dd>{data.beneficiaryDob ? formatDate(data.beneficiaryDob) : "—"}</dd>
              </div>
              <div>
                <dt>Số giấy tờ</dt>
                <dd>{data.beneficiaryIdNumber ? formatIdNumber(data.beneficiaryIdNumber) : "—"}</dd>
              </div>
              <div>
                <dt>Số điện thoại</dt>
                <dd>{data.beneficiaryPhone ? formatPhone(data.beneficiaryPhone) : "—"}</dd>
              </div>
              <div>
                <dt>Người tạo</dt>
                <dd>{data.createdByName ?? "—"}</dd>
              </div>
            </dl>

            {advance.isError && (
              <Alert tone="error">Không đổi được trạng thái đơn này.</Alert>
            )}

            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={data.status !== "done"}
                onClick={() => downloadSummary(data)}
              >
                <Download size={16} />
                Tải PDF
              </Button>
              {canHandleFallback && data.status === "manual-queued" && (
                <Button
                  disabled={advance.isPending}
                  onClick={() => advance.mutate("manual-progress")}
                >
                  <CheckCircle2 size={16} />
                  Nhận đơn xử lý
                </Button>
              )}
              {canHandleFallback && data.status === "manual-progress" && (
                <Button disabled={advance.isPending} onClick={() => advance.mutate("done")}>
                  <CheckCircle2 size={16} />
                  Đánh dấu hoàn thành
                </Button>
              )}
            </div>
            {data.status !== "done" && (
              <p className={styles.footnote}>Chưa có file PDF — đơn chưa xử lý xong.</p>
            )}
          </SectionCard>
        )}
      </main>
    </>
  );
}

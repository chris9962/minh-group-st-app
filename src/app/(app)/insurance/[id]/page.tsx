"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useRef } from "react";
import { CheckCircle2, ChevronLeft, ImagePlus, ShieldCheck } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchInsuranceDetail } from "@/lib/api/insurance";
import {
  INSURANCE_STATUS_LABEL,
  setInsuranceOrderPhoto,
  setInsuranceOrderStatus,
} from "@/lib/api/insuranceOrders";
import { formatDate, formatIdNumber, formatPhone } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const SOURCE_LABEL = { self: "Tự mua", gift: "Quà tặng" } as const;

/** P-14 · Chi tiết đơn bảo hiểm — chỉ xem, không có nút sửa/huỷ sau khi đơn đã chạy. */
export default function InsuranceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
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

  const uploadPhoto = useMutation({
    mutationFn: (photoUrl: string) => setInsuranceOrderPhoto(id, photoUrl, actor?.id ?? ""),
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

        {isPending && <SkeletonCard lines={5} />}
        {isError && (
          <ErrorState what="đơn bảo hiểm này" onRetry={refetch} retrying={isFetching} />
        )}

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
                <dt>Ngày bắt đầu</dt>
                <dd>{formatDate(data.date)}</dd>
              </div>
              <div>
                <dt>Ngày kết thúc</dt>
                <dd>{data.endDate ? formatDate(data.endDate) : "—"}</dd>
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
              {data.product === "BH xe máy" && (
                <>
                  <div>
                    <dt>Biển số xe</dt>
                    <dd>{data.licensePlate || "—"}</dd>
                  </div>
                  <div>
                    <dt>Số khung</dt>
                    <dd>{data.chassisNumber || "—"}</dd>
                  </div>
                  <div>
                    <dt>Số máy</dt>
                    <dd>{data.engineNumber || "—"}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Người tạo</dt>
                <dd>{data.createdByName ?? "—"}</dd>
              </div>
            </dl>

            {advance.isError && <Alert tone="error">Không đổi được trạng thái đơn này.</Alert>}
            {uploadPhoto.isError && (
              <Alert tone="error">Không lưu được ảnh chứng nhận này.</Alert>
            )}

            <div className={styles.photoSection}>
              <h3 className={styles.photoTitle}>Ảnh chứng nhận bảo hiểm</h3>
              {data.certificatePhotoUrl ? (
                <a
                  href={data.certificatePhotoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.photoLink}
                >
                  <img
                    src={data.certificatePhotoUrl}
                    alt="Ảnh chứng nhận bảo hiểm"
                    className={styles.photo}
                  />
                </a>
              ) : (
                <p className="text-muted">Chưa có ảnh — dùng ở mọi trạng thái, không cần chờ hoàn thành.</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className={styles.hiddenInput}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  uploadPhoto.mutate(URL.createObjectURL(file));
                  e.target.value = "";
                }}
              />
              <Button
                variant="secondary"
                disabled={uploadPhoto.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={16} />
                {data.certificatePhotoUrl ? "Đổi ảnh" : "Tải ảnh lên"}
              </Button>
            </div>

            {(canHandleFallback && (data.status === "manual-queued" || data.status === "manual-progress")) && (
              <div className={styles.actions}>
                {data.status === "manual-queued" && (
                  <Button
                    disabled={advance.isPending}
                    onClick={() => advance.mutate("manual-progress")}
                  >
                    <CheckCircle2 size={16} />
                    Nhận đơn xử lý
                  </Button>
                )}
                {data.status === "manual-progress" && (
                  <Button disabled={advance.isPending} onClick={() => advance.mutate("done")}>
                    <CheckCircle2 size={16} />
                    Đánh dấu hoàn thành
                  </Button>
                )}
              </div>
            )}
          </SectionCard>
        )}
      </main>
    </>
  );
}

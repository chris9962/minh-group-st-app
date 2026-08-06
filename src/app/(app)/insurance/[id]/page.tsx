"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ImagePlus, ShieldCheck } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchInsuranceDetail,
  setInsuranceOrderPhoto,
  setInsuranceOrderStatus,
} from "@/lib/api/insurance";
import { INSURANCE_STATUS_LABEL, type InsuranceManualStep } from "@/lib/api/insuranceOrders";
import { imageProblem, uploadImage } from "@/lib/api/uploads";
import { formatDate, formatIdNumber, formatPhone, formatVnd } from "@/lib/format";
import { can } from "@/lib/permissions";
import { vehicleTypeLabel } from "@/lib/pvi";
import { errorMessage, toast } from "@/lib/toast";
import { PRODUCT_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const SOURCE_LABEL = { self: "Tự mua", gift: "Quà tặng" } as const;

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

/**
 * P-14 · Chi tiết đơn bảo hiểm.
 *
 * Gộp luôn P-16 (xử lý đơn lỗi): hai nút "Nhận đơn xử lý" / "Đánh dấu hoàn
 * thành" hiện ngay ở đây với người có quyền `handle-fallback` và đúng trạng
 * thái tương ứng — không tách màn riêng.
 */
export default function InsuranceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["insurance-detail", id],
    queryFn: () => fetchInsuranceDetail(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["insurance-detail", id] });
    queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
  };

  const advance = useMutation({
    mutationFn: (status: InsuranceManualStep) => setInsuranceOrderStatus(id, status),
    onSuccess: (order) => {
      invalidate();
      toast.ok(
        order.status === "done"
          ? `Đã hoàn thành đơn ${order.orderCode}`
          : `Bạn đang xử lý đơn ${order.orderCode}`,
      );
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái đơn này.")),
  });

  /**
   * Hai nhịp: đẩy file lên kho lấy URL, rồi mới gửi URL vào endpoint nghiệp vụ.
   * Tách vậy để một lần tải hỏng giữa chừng không kéo theo cả bản ghi.
   */
  const savePhoto = useMutation({
    mutationFn: (url: string) => setInsuranceOrderPhoto(id, url),
    onSuccess: () => {
      invalidate();
      toast.ok("Đã lưu ảnh chứng nhận");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ảnh chứng nhận này.")),
  });

  const pickPhoto = async (file: File) => {
    const problem = imageProblem(file);
    if (problem) {
      toast.fail(problem);
      return;
    }
    setUploading(true);
    try {
      savePhoto.mutate(await uploadImage(file));
    } catch (e) {
      toast.fail(errorMessage(e, "Không tải được ảnh này lên."));
    } finally {
      setUploading(false);
    }
  };

  const canHandleFallback = can(actor, "insurance", "handle-fallback");
  // Đội xử lý tay đính tờ chứng nhận vừa lấy về từ PVI (spec §9.2) nhưng không
  // nhất thiết có `update` — máy chủ gác đúng cặp quyền này.
  const canAttachPhoto =
    can(actor, "insurance", "update") || canHandleFallback;
  const busy = uploading || savePhoto.isPending;

  return (
    <>
      <TopBar title={data ? `${data.orderCode} · ${data.customerName}` : "Đơn bảo hiểm"} />

      <main className={styles.body}>
        <Link href="/insurance" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Bảo hiểm
        </Link>

        {isPending && <SkeletonCard lines={5} />}
        {isError && <ErrorState what="đơn bảo hiểm này" onRetry={refetch} retrying={isFetching} />}

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
                  <Link href={`/customers/${data.customerId}`} className={styles.customerLink}>
                    {data.customerName}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Mã đơn</dt>
                <dd>{data.orderCode}</dd>
              </div>
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusTag ok={data.status === "done"}>
                    {INSURANCE_STATUS_LABEL[data.status]}
                    {data.handledByName ? ` · ${data.handledByName}` : ""}
                  </StatusTag>
                </dd>
              </div>
              <div>
                <dt>Sản phẩm</dt>
                <dd>{PRODUCT_LABEL[data.product]}</dd>
              </div>
              <div>
                <dt>Gói</dt>
                <dd>{data.packageName}</dd>
              </div>
              <div>
                <dt>Mức phí</dt>
                <dd>{formatVnd(data.fee)}</dd>
              </div>
              <div>
                <dt>Ngày bắt đầu</dt>
                <dd>{formatDate(data.date)}</dd>
              </div>
              <div>
                <dt>Ngày kết thúc</dt>
                <dd>{formatDate(data.endDate)}</dd>
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
                <dd>
                  {data.beneficiaryIdNumber ? formatIdNumber(data.beneficiaryIdNumber) : "—"}
                </dd>
              </div>
              <div>
                <dt>Số điện thoại</dt>
                <dd>{data.beneficiaryPhone ? formatPhone(data.beneficiaryPhone) : "—"}</dd>
              </div>
              <div>
                <dt>Địa chỉ</dt>
                <dd>{data.beneficiaryAddress || "—"}</dd>
              </div>
              {data.product === "motorbike" && (
                <>
                  <div>
                    <dt>Biển số xe</dt>
                    <dd>{data.licensePlate || "—"}</dd>
                  </div>
                  <div>
                    <dt>Loại xe</dt>
                    <dd>{data.vehicleType ? vehicleTypeLabel(data.vehicleType) : "—"}</dd>
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

            <div className={styles.photoSection}>
              <h3 className={styles.photoTitle}>Ảnh chứng nhận bảo hiểm</h3>
              {data.certificatePhotoUrl ? (
                <a
                  href={data.certificatePhotoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.photoLink}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.certificatePhotoUrl}
                    alt="Ảnh chứng nhận bảo hiểm"
                    className={styles.photo}
                  />
                </a>
              ) : (
                <p className="text-muted">
                  Chưa có ảnh — đính được ở mọi trạng thái, không cần chờ hoàn thành.
                </p>
              )}
              {canAttachPhoto && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className={styles.hiddenInput}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Xoá giá trị NGAY: chọn lại đúng file vừa rồi (sau một
                      // lần hỏng) thì `change` không bắn nếu value còn nguyên.
                      e.target.value = "";
                      if (file) void pickPhoto(file);
                    }}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus size={16} aria-hidden />
                    {busy
                      ? "Đang tải ảnh…"
                      : data.certificatePhotoUrl
                        ? "Đổi ảnh"
                        : "Tải ảnh lên"}
                  </Button>
                </>
              )}
            </div>

            {canHandleFallback &&
              (data.status === "manual-queued" || data.status === "manual-progress") && (
                <div className={styles.actions}>
                  {data.status === "manual-queued" && (
                    <Button
                      disabled={advance.isPending}
                      onClick={() => advance.mutate("manual-progress")}
                    >
                      <CheckCircle2 size={16} aria-hidden />
                      Nhận đơn xử lý
                    </Button>
                  )}
                  {data.status === "manual-progress" && (
                    <Button disabled={advance.isPending} onClick={() => advance.mutate("done")}>
                      <CheckCircle2 size={16} aria-hidden />
                      Đánh dấu hoàn thành
                    </Button>
                  )}
                </div>
              )}
          </SectionCard>
        )}

        {data && (
          <SectionCard title="Dòng thời gian" icon={<ShieldCheck size={17} />}>
            <ol className={styles.timeline}>
              {data.history.map((step) => (
                <li key={step.id}>
                  <span className={styles.stepAt}>{formatDateTime(step.changedAt)}</span>
                  <span className={styles.stepWhat}>
                    {step.fromStatus
                      ? `${INSURANCE_STATUS_LABEL[step.fromStatus]} → ${INSURANCE_STATUS_LABEL[step.toStatus]}`
                      : `Tạo đơn · ${INSURANCE_STATUS_LABEL[step.toStatus]}`}
                  </span>
                  {/* Không có người bấm nghĩa là hệ thống tự chuyển (spec §3.4). */}
                  <span className={styles.stepWho}>{step.changedByName ?? "Hệ thống"}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
        )}
      </main>
    </>
  );
}

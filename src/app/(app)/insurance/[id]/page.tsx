"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, EyeOff, ImagePlus, ShieldCheck, X } from "lucide-react";
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
import {
  INSURANCE_STATUS_LABEL,
  INSURANCE_STATUS_TONE,
  type InsuranceManualStep,
} from "@/lib/api/insuranceOrders";
import { imageProblem, uploadImage } from "@/lib/api/uploads";
import { formatDate, formatIdNumber, formatPhone, formatVnd } from "@/lib/format";
import { can, recordInScope, recordVisibility } from "@/lib/permissions";
import { vehicleTypeLabel } from "@/lib/pvi";
import { errorMessage, toast } from "@/lib/toast";
import { PRODUCT_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const SOURCE_LABEL = { self: "Tự mua", gift: "Quà tặng" } as const;

/**
 * Ảnh đã chọn nhưng CHƯA lên kho — `preview` là một `blob:` chỉ sống trong đúng
 * tab đang mở, tải lại trang là mất. Nó không bao giờ được đi vào bản ghi.
 */
type PendingPhoto = { file: File; preview: string };

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

  /**
   * Ảnh CHỌN XONG KHÔNG tải lên ngay (chốt 2026-08-16) — cùng lối với ảnh tài
   * khoản ngân hàng. Nó nằm lại trong máy tới lúc bấm Lưu ảnh hoặc Đánh dấu
   * hoàn thành. Chọn nhầm tấm thì không tốn một lượt tải và không để lại một
   * tấm rác trên kho.
   */
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  // `blob:` chiếm bộ nhớ tới khi được thu hồi và trình duyệt không tự dọn. Giữ
  // thêm ở ref vì lúc dọn khi rời trang thì không đọc được state mới nhất.
  const pendingRef = useRef<PendingPhoto | null>(null);

  const replacePending = useCallback((next: PendingPhoto | null) => {
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.preview);
    pendingRef.current = next;
    setPending(next);
  }, []);

  useEffect(
    () => () => {
      if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.preview);
    },
    [],
  );

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["insurance-detail", id],
    queryFn: () => fetchInsuranceDetail(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["insurance-detail", id] });
    queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
  };

  const acceptPhoto = useCallback(
    (file: File) => {
      // Chặn sớm cho người dùng biết ngay, KHÔNG phải để tin tưởng — máy chủ
      // kiểm lại bằng chữ ký đầu file.
      const problem = imageProblem(file);
      if (problem) {
        toast.fail(problem);
        return;
      }
      replacePending({ file, preview: URL.createObjectURL(file) });
    },
    [replacePending],
  );

  const canHandleFallback = can(actor, "insurance", "handle-fallback");
  /**
   * Hỏi theo ĐÚNG BẢN GHI này, khớp từng vế với `setCertificatePhoto`.
   *
   * Đội xử lý tay đính tờ chứng nhận lấy về từ PVI (spec §9.2) nhưng không nhất
   * thiết có `update`, nên phải hỏi cả hai quyền, cộng vế "tôi đang cầm đơn
   * này". Bản trước chỉ hỏi `can()` ở mức module: nút hiện trên mọi đơn, bấm
   * vào thì máy chủ trả 404.
   */
  const canAttachPhoto = Boolean(
    data &&
      (recordInScope(recordVisibility(actor, "insurance", "update"), data) ||
        recordInScope(recordVisibility(actor, "insurance", "handle-fallback"), data) ||
        (canHandleFallback && data.handledById === actor?.id)),
  );

  /**
   * Chụp màn hình rồi Ctrl+V — nghe ở CẢ TRANG, không bắt bấm vào một ô trước.
   *
   * Người xử lý tay chụp tờ chứng nhận bên PVI rồi chuyển sang tab này dán
   * luôn; bắt họ tìm và bấm đúng một ô trống trước khi dán là thêm một bước
   * không có lý do.
   *
   * Ảnh chụp màn hình nằm ở `clipboardData.files`, KHÔNG phải chuỗi text — nên
   * một ô `input` bình thường không nhận được nó.
   *
   * Đây là đồng bộ với hệ thống ngoài React (sự kiện của document) nên dùng
   * effect là đúng chỗ, và có cleanup (AGENTS.md §7).
   */
  useEffect(() => {
    if (!canAttachPhoto) return;

    const onPaste = (e: ClipboardEvent) => {
      // Đang gõ trong một ô nhập thì trả phím dán về đúng việc của nó.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']")) return;

      const file = [...(e.clipboardData?.files ?? [])].find((f) =>
        f.type.startsWith("image/"),
      );
      if (!file) return;
      e.preventDefault();
      acceptPhoto(file);
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canAttachPhoto, acceptPhoto]);

  /**
   * Hai nhịp: đẩy file lên kho lấy URL, rồi mới gửi URL vào endpoint nghiệp vụ.
   * Tách vậy để một lần tải hỏng giữa chừng không kéo theo cả bản ghi.
   */
  const uploadPending = useCallback(async () => {
    const current = pendingRef.current;
    if (!current) return;
    await setInsuranceOrderPhoto(id, await uploadImage(current.file));
    replacePending(null);
  }, [id, replacePending]);

  const savePhoto = useMutation({
    mutationFn: uploadPending,
    onSuccess: () => {
      invalidate();
      toast.ok("Đã lưu ảnh chứng nhận");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ảnh chứng nhận này.")),
  });

  const advance = useMutation({
    mutationFn: async (status: InsuranceManualStep) => {
      // Ảnh đi TRƯỚC, đổi trạng thái đi sau. Máy chủ đọc `certificate_photo_url`
      // từ database khi kiểm bước sang `done`, nên chưa ghi xong URL thì chính
      // lượt bấm này bị từ chối.
      if (status === "done") await uploadPending();
      return setInsuranceOrderStatus(id, status);
    },
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

  const busy = savePhoto.isPending || advance.isPending;
  /** Có ảnh để hoàn thành: đã lưu trên máy chủ, hoặc đang chờ lưu ở đây. */
  const hasPhoto = Boolean(data?.certificatePhotoUrl) || pending !== null;

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
                  <StatusTag tone={INSURANCE_STATUS_TONE[data.status]}>
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
                {/* Ngày TẠO đơn — thứ quyết định đơn này tính vào tháng nào. */}
                <dt>Ngày tạo đơn</dt>
                <dd>{formatDate(data.orderDate)}</dd>
              </div>
              <div>
                <dt>Hiệu lực từ</dt>
                <dd>{formatDate(data.startDate)}</dd>
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
                  {/* Ẩn HẲN số, không hiện 4 số cuối: người chưa nhận đơn không
                      có việc gì cần tới nó. Icon kèm lời giải thích để người
                      dùng biết là "chưa được xem", không phải "đơn thiếu dữ
                      liệu" rồi đi nhập lại. */}
                  {data.beneficiaryIdNumberHidden ? (
                    <span
                      className={styles.hiddenValue}
                      title="Nhận đơn về xử lý thì mới xem được số giấy tờ của người thụ hưởng."
                    >
                      <EyeOff size={15} aria-hidden />
                      Đã ẩn
                    </span>
                  ) : data.beneficiaryIdNumber ? (
                    formatIdNumber(data.beneficiaryIdNumber)
                  ) : (
                    "—"
                  )}
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
              {data.product === "electric-accident" && (
                <>
                  <div>
                    <dt>Số thành viên</dt>
                    <dd>{data.householdSize || "—"}</dd>
                  </div>
                  <div>
                    <dt>Số tiền bảo hiểm</dt>
                    <dd>{data.sumInsured ? formatVnd(data.sumInsured) : "—"}</dd>
                  </div>
                </>
              )}
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
              {/* Ảnh đang chờ lưu che lên ảnh cũ: người dùng phải thấy đúng
                  tấm mình vừa chọn, kèm nhãn CHỮ nói nó chưa được lưu — màu
                  một mình không đủ (AGENTS.md §8). */}
              {pending ? (
                <div className={styles.pendingPhoto}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pending.preview} alt="Ảnh vừa chọn" className={styles.photo} />
                  <span className={styles.pendingBadge}>Chưa lưu</span>
                  <button
                    type="button"
                    className={styles.photoRemove}
                    aria-label="Bỏ ảnh vừa chọn"
                    disabled={busy}
                    onClick={() => replacePending(null)}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </div>
              ) : data.certificatePhotoUrl ? (
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
                      if (file) acceptPhoto(file);
                    }}
                  />
                  <div className={styles.photoActions}>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImagePlus size={16} aria-hidden />
                      {data.certificatePhotoUrl || pending ? "Đổi ảnh" : "Chọn ảnh"}
                    </Button>
                    {pending && (
                      <Button disabled={busy} onClick={() => savePhoto.mutate()}>
                        {savePhoto.isPending ? "Đang lưu…" : "Lưu ảnh"}
                      </Button>
                    )}
                  </div>
                  <p className="text-muted">
                    Chụp màn hình xong, bấm <strong>Ctrl + V</strong> ở bất kỳ đâu trên
                    trang này để dán ảnh vào.
                  </p>
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
                  {/* Thiếu ảnh thì KHOÁ nút, không phải giấu: người dùng phải
                      đọc được vì sao chưa bấm được, và ô tải ảnh nằm ngay trên.
                      Máy chủ vẫn từ chối lần nữa — khoá đây chỉ để đỡ một lượt
                      bấm hỏng (AGENTS.md §6). */}
                  {data.status === "manual-progress" && (
                    <>
                      <Button disabled={busy || !hasPhoto} onClick={() => advance.mutate("done")}>
                        <CheckCircle2 size={16} aria-hidden />
                        {advance.isPending ? "Đang lưu…" : "Đánh dấu hoàn thành"}
                      </Button>
                      {!hasPhoto && (
                        <p className="text-muted">
                          Phải đính ảnh chứng nhận bảo hiểm trước khi đánh dấu hoàn thành.
                        </p>
                      )}
                    </>
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

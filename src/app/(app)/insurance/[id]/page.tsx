"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, Download, EyeOff, History, ImagePlus, ShieldCheck, X } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { downloadImage } from "@/lib/downloadImage";
import { CopyButton } from "@/components/ui/CopyValue";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { Alert } from "@/components/ui/Alert";
import {
  fetchInsuranceDetail,
  setInsuranceOrderPhoto,
  setInsuranceOrderStatus,
} from "@/lib/api/insurance";
import {
  CERTIFICATE_HELP_MESSAGE,
  certificateNeedsHelp,
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

/** Một cặp nhãn — giá trị. `wide` cho giá trị dài chiếm trọn hàng lưới. */
/**
 * Một trường, kèm nút chép khi `copy` có giá trị.
 *
 * Người xử lý đơn tay phải gõ lại từng trường sang web PVI, nên mỗi lần gõ tay
 * là một lần gõ sai được. CCCD người thụ hưởng CỐ Ý không có nút này — nó là
 * trường gác bằng quyền riêng (`beneficiaryIdNumberHidden`), và một nút chép
 * đứng cạnh chữ "Đã ẩn" là nói sai rằng vẫn lấy được số.
 *
 * `copy` tách khỏi `children` vì hai thứ khác nhau: màn hình hiện
 * "10.000.000 ₫", còn form PVI nhận `10000000`.
 */
function Field({
  label,
  wide = false,
  copy,
  children,
}: {
  label: string;
  wide?: boolean;
  copy?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? styles.fieldWide : undefined}>
      <dt>{label}</dt>
      <dd className={styles.fieldValue}>
        <span className={styles.fieldText}>{children}</span>
        {copy ? <CopyButton value={copy} label={`${label}: ${copy}`} quiet /> : null}
      </dd>
    </div>
  );
}

/**
 * Nhóm trường có tiêu đề.
 *
 * Bản trước đổ mười tám trường vào một lưới phẳng, nên người xử lý đơn phải đọc
 * từng nhãn để tìm biển số xe giữa các trường của người thụ hưởng. Gom theo chủ
 * thể — đơn, người thụ hưởng, xe — thì mắt nhảy thẳng tới đúng nhóm.
 */
function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <dl className={styles.fields}>{children}</dl>
    </section>
  );
}

/**
 * Ảnh kèm trạng thái tải.
 *
 * `<img>` không báo gì trong lúc tải: người dùng đổi ảnh xong chỉ thấy một ô
 * trống và không biết ảnh đang về hay đã hỏng. Ảnh chụp bằng điện thoại vài
 * MB thì quãng trống này kéo dài thấy rõ.
 *
 * Người gọi đặt `key={src}` để trạng thái reset khi đổi ảnh — reset theo prop
 * bằng `key`, không bằng effect (AGENTS.md §7).
 */
function PhotoView({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={styles.photo}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
      />
      {state !== "ready" && (
        <span
          role="status"
          className={`${styles.photoStatus} ${state === "failed" ? styles.photoStatusFailed : ""}`}
        >
          {state === "loading" ? "Đang tải ảnh…" : "Không tải được ảnh"}
        </span>
      )}
    </>
  );
}

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
  /**
   * KHÔNG kẹp theo trạng thái đơn — chốt 2026-08-22.
   *
   * Commit `19afde4` (2026-08-18) từng thêm điều kiện `status === "manual-progress"`
   * với lý do "đơn hoàn thành thì tờ chứng nhận đã nộp". Chủ dự án chốt lại:
   * đơn hoàn thành rồi vẫn phải đổi được ảnh — tờ chứng nhận chụp mờ hay chụp
   * nhầm tờ chỉ lộ ra sau đó.
   *
   * Đây cũng là điều spec §3.4 viết từ đầu: "ảnh chứng nhận dùng được ở MỌI
   * trạng thái, không gắn riêng vào bước nào". Máy chủ vốn chưa bao giờ chặn
   * theo trạng thái, nên chỉ giao diện lệch.
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
  /** Ảnh đang xem cỡ lớn; `null` = không mở. */
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null);
  /** Có ảnh để hoàn thành: đã lưu trên máy chủ, hoặc đang chờ lưu ở đây. */
  const hasPhoto = Boolean(data?.certificatePhotoUrl) || pending !== null;

  return (
    <>
      <TopBar
        title={data ? `${data.orderCode} · ${data.customerName}` : "Đơn bảo hiểm"}
        keepTitleOnMobile
      />

      <main className={styles.body}>
        <Link href="/insurance" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Bảo hiểm
        </Link>

        {isPending && <SkeletonCard lines={5} />}
        {isError && <ErrorState what="đơn bảo hiểm này" onRetry={refetch} retrying={isFetching} />}

        {data && (
          <SectionCard title="Chi tiết đơn bảo hiểm" icon={<ShieldCheck size={17} />}>
            <div className={styles.detail}>
              <div className={styles.summary}>
                {/* Mã đơn là ĐỊNH DANH, không phải tiêu đề nhóm — để `h3` thì
                    nó đứng ngang hàng với "Người thụ hưởng", "Thông tin xe"
                    trong cây tiêu đề mà không chứa nhóm nào. */}
                <p className={styles.orderCode}>
                  {data.orderCode}
                  <CopyButton value={data.orderCode} label={`mã đơn: ${data.orderCode}`} quiet />
                </p>
                <StatusTag tone={INSURANCE_STATUS_TONE[data.status]}>
                  {INSURANCE_STATUS_LABEL[data.status]}
                </StatusTag>
                {/* Bot đã thôi hỏi PVI. Không nói ra thì dòng này trông y hệt
                    đơn vừa duyệt xong và đang đợi bình thường. */}
                {certificateNeedsHelp(data.status, data.certificateAttempts) && (
                  <Alert tone="warning">{CERTIFICATE_HELP_MESSAGE}</Alert>
                )}
                <p className={styles.summaryLine}>
                  <Link href={`/customers/${data.customerId}`} className={styles.customerLink}>
                    {data.customerName}
                  </Link>
                  {` · ${SOURCE_LABEL[data.source]}`}
                </p>
              </div>

              {/* Năm giá trị người dùng tra nhiều nhất, tách ra nền riêng: đọc
                  được ngay mà không phải quét hết danh sách trường bên dưới. */}
              <dl className={styles.highlights}>
                <Field label="Sản phẩm">{PRODUCT_LABEL[data.product]}</Field>
                <Field label="Gói" copy={data.packageName}>
                  {data.packageName}
                </Field>
                {/* Chép SỐ TRẦN, không chép chuỗi đã định dạng — form PVI nhận
                    `10000000`, dán "10.000.000 ₫" vào là ô từ chối. */}
                <Field label="Mức phí" copy={String(data.fee)}>
                  {formatVnd(data.fee)}
                </Field>
                <Field label="Hiệu lực từ" copy={formatDate(data.startDate)}>
                  {formatDate(data.startDate)}
                </Field>
                <Field label="Ngày kết thúc" copy={formatDate(data.endDate)}>
                  {formatDate(data.endDate)}
                </Field>
              </dl>

              <FieldGroup title="Người thụ hưởng">
                <Field label="Họ tên" copy={data.beneficiaryName}>
                  {data.beneficiaryName}
                </Field>
                <Field
                  label="Ngày sinh"
                  copy={data.beneficiaryDob ? formatDate(data.beneficiaryDob) : undefined}
                >
                  {data.beneficiaryDob ? formatDate(data.beneficiaryDob) : "—"}
                </Field>
                <Field label="CCCD">
                  {/* Ẩn HẲN số, không hiện 4 số cuối: người chưa nhận đơn không
                      có việc gì cần tới nó. Icon kèm lời giải thích để người
                      dùng biết là "chưa được xem", không phải "đơn thiếu dữ
                      liệu" rồi đi nhập lại. */}
                  {data.beneficiaryIdNumberHidden ? (
                    <span
                      className={styles.hiddenValue}
                      title="Nhận đơn về xử lý thì mới xem được CCCD của người thụ hưởng."
                    >
                      <EyeOff size={15} aria-hidden />
                      Đã ẩn
                    </span>
                  ) : data.beneficiaryIdNumber ? (
                    formatIdNumber(data.beneficiaryIdNumber)
                  ) : (
                    "—"
                  )}
                </Field>
                {/* Chép số THÔ: `formatPhone` chèn khoảng trắng cho dễ đọc, mà
                    ô SĐT của PVI từ chối khoảng trắng. */}
                <Field label="Số điện thoại" copy={data.beneficiaryPhone || undefined}>
                  {data.beneficiaryPhone ? formatPhone(data.beneficiaryPhone) : "—"}
                </Field>
                <Field label="Địa chỉ" wide copy={data.beneficiaryAddress || undefined}>
                  {data.beneficiaryAddress || "—"}
                </Field>
              </FieldGroup>

              {data.product === "electric-accident" && (
                <FieldGroup title="Quyền lợi bảo hiểm">
                  <Field
                    label="Số thành viên"
                    copy={data.householdSize ? String(data.householdSize) : undefined}
                  >
                    {data.householdSize || "—"}
                  </Field>
                  <Field
                    label="Số tiền bảo hiểm"
                    copy={data.sumInsured ? String(data.sumInsured) : undefined}
                  >
                    {data.sumInsured ? formatVnd(data.sumInsured) : "—"}
                  </Field>
                </FieldGroup>
              )}

              {data.product === "motorbike" && (
                <FieldGroup title="Thông tin xe">
                  <Field label="Biển số xe" copy={data.licensePlate || undefined}>
                    {data.licensePlate || "—"}
                  </Field>
                  {/* Chép MÃ loại xe, không chép nhãn đọc cho người —
                      `vehicleTypeLabel` trả "A1 – Xe mô tô…", PVI nhận "A1". */}
                  <Field label="Loại xe" copy={data.vehicleType || undefined}>
                    {data.vehicleType ? vehicleTypeLabel(data.vehicleType) : "—"}
                  </Field>
                  <Field label="Số khung" copy={data.chassisNumber || undefined}>
                    {data.chassisNumber || "—"}
                  </Field>
                  <Field label="Số máy" copy={data.engineNumber || undefined}>
                    {data.engineNumber || "—"}
                  </Field>
                </FieldGroup>
              )}

              <FieldGroup title="Ghi nhận">
                {/* Ngày TẠO đơn — thứ quyết định đơn này tính vào tháng nào. */}
                <Field label="Ngày tạo đơn">{formatDate(data.orderDate)}</Field>
                <Field label="Người tạo">{data.createdByName ?? "—"}</Field>
                <Field label="Người xử lý">{data.handledByName ?? "—"}</Field>
              </FieldGroup>

            <div className={styles.photoSection}>
              <h3 className={styles.photoTitle}>Ảnh chứng nhận bảo hiểm</h3>
              {/* Ảnh đang chờ lưu che lên ảnh cũ: người dùng phải thấy đúng
                  tấm mình vừa chọn, kèm nhãn CHỮ nói nó chưa được lưu — màu
                  một mình không đủ (AGENTS.md §8). */}
              {pending ? (
                <div className={styles.pendingPhoto}>
                  <button
                    type="button"
                    className={styles.photoZoom}
                    aria-label="Xem ảnh vừa chọn cỡ lớn"
                    onClick={() => setZoomed({ src: pending.preview, alt: "Ảnh vừa chọn" })}
                  >
                    <PhotoView key={pending.preview} src={pending.preview} alt="Ảnh vừa chọn" />
                  </button>
                  <span className={styles.pendingBadge}>Chưa lưu</span>
                  {/* Nút này không phải component `Button` nên không có prop
                      `tooltip` — dùng `title` của trình duyệt cho cùng tác dụng. */}
                  <button
                    type="button"
                    className={styles.photoRemove}
                    title="Bỏ ảnh vừa chọn"
                    aria-label="Bỏ ảnh vừa chọn"
                    disabled={busy}
                    onClick={() => replacePending(null)}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </div>
              ) : data.certificatePhotoUrl ? (
                /* Xem NGAY TẠI TRANG, không mở tab mới. Đội xử lý tay đối
                   chiếu số trên tờ chứng nhận với số trên đơn — mở tab khác là
                   mất đơn khỏi màn hình, đúng lý do màn ngân hàng cũng dùng
                   `ImageLightbox` chứ không phải liên kết. */
                <button
                  type="button"
                  className={styles.photoLink}
                  aria-label="Xem ảnh chứng nhận cỡ lớn"
                  onClick={() =>
                    setZoomed({
                      src: data.certificatePhotoUrl!,
                      alt: "Ảnh chứng nhận bảo hiểm",
                    })
                  }
                >
                  <PhotoView
                    key={data.certificatePhotoUrl}
                    src={data.certificatePhotoUrl}
                    alt="Ảnh chứng nhận bảo hiểm"
                  />
                </button>
              ) : (
                <p className="text-muted">Chưa có ảnh.</p>
              )}
              {/* Ngoài khối `canAttachPhoto` bên dưới: người chỉ có quyền XEM
                  đơn vẫn cần tải tờ chứng nhận về để gửi khách. */}
              {(data.certificatePhotoUrl || pending) && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadImage(
                      pending?.preview ?? data.certificatePhotoUrl!,
                      pending ? "Ảnh vừa chọn" : "Ảnh chứng nhận bảo hiểm",
                    )
                  }
                >
                  <Download size={16} aria-hidden />
                  Tải ảnh về
                </Button>
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
                        <p className={`text-muted ${styles.actionsNote}`}>
                          Phải đính ảnh chứng nhận bảo hiểm trước khi đánh dấu hoàn thành.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {data && (
          <SectionCard title="Dòng thời gian" icon={<History size={17} />}>
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

      {zoomed && (
        <ImageLightbox src={zoomed.src} alt={zoomed.alt} onClose={() => setZoomed(null)} />
      )}
    </>
  );
}

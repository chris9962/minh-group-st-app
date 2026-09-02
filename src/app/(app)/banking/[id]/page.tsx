"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, ChevronLeft, Landmark, Pencil, RotateCcw, TriangleAlert, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Dialog } from "@/components/ui/Dialog";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountEditDialog } from "@/components/banking/BankAccountEditDialog";
import { BankAccountFinishFields } from "@/components/banking/BankAccountFinishFields";
import {
  BankAccountPhotos,
  photosChanged,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "@/components/banking/BankAccountPhotos";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextArea } from "@/components/ui/TextArea";
import {
  AccountType,
  BankAccountFinishForm,
  deleteBankAccount,
  finishBankAccount,
  setBankAccountPhotos,
  updateBankAccountStatus,
} from "@/lib/api/bankAccounts";
import { fetchBankAccountDetail, type BankAccountDetail } from "@/lib/api/banking";
import { fetchDepartments } from "@/lib/api/departments";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { can } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { formatDate, formatPhone, businessDay } from "@/lib/format";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";
import { reportInvalid } from "@/lib/formErrors";

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  none: "Tài khoản thường",
  CNKD: "Tài khoản CNKD",
  HKD: "Tài khoản HKD",
};

/**
 * P-22 · Chi tiết tài khoản ngân hàng.
 *
 * `status = done` — chỉ xem, sửa được mỗi ảnh chứng minh.
 * `status = creating` — BƯỚC 2 của P-20 (spec §4.5): KD đã giữ chỗ mã và đi
 * mở tài khoản thật bên ngoài, quay lại đây điền nốt + đủ ảnh rồi mới hoàn
 * thành. Mã giới thiệu chỉ thật sự bị tiêu lúc bấm "Hoàn thành" ở đây.
 */
export default function BankAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-account-detail", id],
    queryFn: () => fetchBankAccountDetail(id),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });
  const departmentName = departments.find((d) => d.id === data?.createdByDepartmentId)?.name;

  return (
    <>
      <TopBar
        title={data ? `${data.bankCode} · ${data.customerName}` : "Tài khoản ngân hàng"}
        keepTitleOnMobile
      />

      <main className={styles.body}>
        <Link href="/banking" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Ngân hàng
        </Link>

        {isPending && <SkeletonCard lines={5} />}
        {isError && (
          <ErrorState what="tài khoản này" onRetry={refetch} retrying={isFetching} />
        )}

        {data && data.status === "creating" && (
          <FinishAccountCard id={id} data={data} departmentName={departmentName} />
        )}

        {data && (data.status === "done" || data.status === "error") && (
          <DoneAccountCard id={id} data={data} departmentName={departmentName} />
        )}
      </main>
    </>
  );
}

function FinishAccountCard({
  id,
  data,
  departmentName,
}: {
  id: string;
  data: BankAccountDetail;
  departmentName?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const finishForm = useForm<BankAccountFinishForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(BankAccountFinishForm),
    defaultValues: {
      /**
       * Ngân hàng lấy số tài khoản theo SĐT thì điền sẵn SỐ CHÍNH — phần lớn
       * khách mở bằng số đó. Nhân viên đổi sang số phụ ngay trong ô chọn nếu
       * khách dùng số khác. `customerPhones[0]` là số chính, máy chủ đã sắp.
       *
       * Ngân hàng NHẬP TAY có tiền tố (P-60) thì điền sẵn tiền tố — nhân viên
       * gõ nốt phần sau.
       *
       * Chỉ điền khi bản ghi CHƯA có số: tài khoản đang sửa mang số thật rồi
       * thì đè lên là ghi lại hợp đồng theo dữ liệu suy đoán.
       */
      accountNumber:
        data.accountNumber ||
        (data.accountNumberMethod === "phone-match"
          ? (data.customerPhones[0] ?? "")
          : data.accountNumberPrefix),
      openedDate: data.date || businessDay(),
      appInstalled: true,
      accountType: "none",
      note: data.note,
    },
  });


  // Hoàn thành/xoá đều đổi số "đang giữ · đã dùng" của mã — invalidate để hộp
  // thoại "Mở ngân hàng" không hiện số cũ tới khi hết 30s staleTime mặc định.
  const invalidateShared = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    if (data.customerId) queryClient.invalidateQueries({ queryKey: ["customer", data.customerId] });
    invalidateKpi(queryClient);
  };

  /** `null` = chưa đụng vào ảnh, cứ lấy theo bản ghi (AGENTS.md §7 — không effect). */
  const [editedPhotos, setEditedPhotos] = useState<PhotoItem[] | null>(null);
  const photos = editedPhotos ?? savedPhotos(data.photoUrls);

  /**
   * Đếm ảnh ĐANG CHỌN, không phải ảnh đã nằm trên máy chủ.
   *
   * Từ khi ảnh chỉ tải lên lúc bấm Lưu, hai con số đó khác nhau: ảnh vừa chọn
   * còn nằm trong máy người dùng. Đếm theo `photoUrls` sinh ra vòng luẩn quẩn —
   * nút mở khoá cần ảnh trên máy chủ, mà lượt tải lên nằm BÊN TRONG hành động
   * hoàn thành, tức sau khi nút đã khoá. Bộ đếm hiện (3/3) mà nút vẫn xám.
   *
   * Hai màn cùng làm việc này (`BankAccountFormDialog`, `BankAccountEditDialog`)
   * đều đếm `photos.length`.
   */
  const enoughPhotos = photos.length >= data.requiredPhotos;

  const finish = useMutation({
    // Ảnh đi trước, bản ghi đi sau: máy chủ đếm ảnh ngay trong giao dịch hoàn
    // thành, nên phải ghi xong danh sách URL rồi mới gọi đường hoàn thành.
    mutationFn: async (form: BankAccountFinishForm) => {
      if (photosChanged(photos, data.photoUrls))
        await setBankAccountPhotos(id, await uploadPendingPhotos(photos));
      return finishBankAccount(id, form);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-detail", id] });
      invalidateShared();
      toast.ok("Đã hoàn tất tài khoản ngân hàng");
      // Cảnh báo mềm mức khách hàng (spec §4.8) — hiện SAU khi đã lưu xong, mỗi
      // luật một dòng riêng để không dồn thành một câu dài không ai đọc.
      for (const w of result.warnings) toast.warn(w);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không hoàn tất được tài khoản này.")),
  });

  const remove = useMutation({
    mutationFn: () => deleteBankAccount(id),
    onSuccess: () => {
      invalidateShared();
      toast.ok("Đã xoá tài khoản đang tạo dở, mã giới thiệu được nhả lại");
      router.push(data.customerId ? `/customers/${data.customerId}` : "/banking");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được tài khoản này.")),
  });

  return (
    <SectionCard title="Hoàn tất tài khoản" icon={<Landmark size={17} />} meta="Đang tạo">
      <dl className={styles.fields}>
        <div>
          <dt>Khách hàng</dt>
          <dd>
            {data.customerId ? (
              <Link href={`/customers/${data.customerId}`}>{data.customerName}</Link>
            ) : (
              data.customerName
            )}
          </dd>
        </div>
        <div>
          <dt>Ngân hàng</dt>
          <dd>{data.bankCode}</dd>
        </div>
        <div>
          <dt>Mã giới thiệu</dt>
          <dd>{data.referralCode}</dd>
        </div>
        <div>
          <dt>Kênh</dt>
          <dd>
            {data.channel || "Không có"}
            {data.channelDetail ? ` · ${data.channelDetail}` : ""}
          </dd>
        </div>
        <div>
          <dt>Đơn vị lúc tạo</dt>
          <dd>{departmentName ?? "—"}</dd>
        </div>
      </dl>


      <BankAccountFinishFields
        formId="finish-account-form"
        onSubmit={finishForm.handleSubmit((form) => finish.mutate(form), reportInvalid)}
        register={finishForm.register}
        errors={finishForm.formState.errors}
        watch={finishForm.watch}
        setValue={finishForm.setValue}
        bankCode={data.bankCode}
        accountNumberMethod={data.accountNumberMethod}
        accountNumberLength={data.accountNumberLength}
        customerPhones={data.customerPhones}
        referralQrUrl={data.referralQrUrl}
        bankGuide={data.bankGuide}
        bankGuidePhotoUrls={data.bankGuidePhotoUrls}
        photos={photos}
        requiredPhotos={data.requiredPhotos}
        onPhotosChange={setEditedPhotos}
        busy={finish.isPending}
      />

      <div className={styles.actions}>
        <Button
          type="submit"
          form="finish-account-form"
          disabled={finishForm.formState.isSubmitting || finish.isPending || !enoughPhotos}
        >
          <CheckCircle2 size={16} />
          Hoàn thành
        </Button>
        <Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>
          <Trash2 size={16} />
          Xoá
        </Button>
      </div>
    </SectionCard>
  );
}

function DoneAccountCard({
  id,
  data,
  departmentName,
}: {
  id: string;
  data: BankAccountDetail;
  departmentName?: string;
}) {
  const user = useSession((s) => s.user);
  const canWrite = can(user, "banking", "update");
  const [editing, setEditing] = useState(false);
  const [markingError, setMarkingError] = useState(false);
  const [errorNote, setErrorNote] = useState("");
  const queryClient = useQueryClient();
  const statusUpdate = useMutation({
    mutationFn: (form: { status: "done" | "error"; errorNote: string }) =>
      updateBankAccountStatus(id, form),
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", data.customerId] });
      invalidateKpi(queryClient);
      setMarkingError(false);
      setErrorNote("");
      toast.ok(account.status === "error" ? "Đã đánh dấu tài khoản lỗi và tính lại KPI" : "Đã khôi phục tài khoản và tính lại KPI");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái tài khoản.")),
  });

  return (
    <SectionCard
      title="Chi tiết tài khoản"
      icon={<Landmark size={17} />}
      /* Bản `done` sửa được từ 07/08 — dùng lại đúng hộp thoại của bảng P-21,
         không dựng biểu mẫu thứ hai để rồi hai chỗ lệch luật nhau. */
      action={
        canWrite ? (
          <>
            {data.status === "done" ? (
              <div className={styles.headerActions}>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil size={16} aria-hidden />
                  Sửa
                </Button>
                <Button variant="secondary" onClick={() => setMarkingError(true)}>
                  <TriangleAlert size={16} aria-hidden />
                  Đánh dấu lỗi
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                disabled={statusUpdate.isPending}
                onClick={() => statusUpdate.mutate({ status: "done", errorNote: "" })}
              >
                <RotateCcw size={16} aria-hidden />
                Khôi phục hoàn thành
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {data.status === "error" && (
        <Alert tone="warning">
          <strong>Tài khoản lỗi — không tính KPI.</strong> {data.errorNote}
        </Alert>
      )}
      {editing && (
        <BankAccountEditDialog open onClose={() => setEditing(false)} accountId={id} />
      )}
      <dl className={styles.fields}>
        <div>
          <dt>Trạng thái</dt>
          <dd>
            <StatusTag tone={data.status === "done" ? "ok" : "warn"}>
              {data.status === "done" ? "Hoàn thành" : "Lỗi"}
            </StatusTag>
          </dd>
        </div>
        <div>
          <dt>Khách hàng</dt>
          <dd>
            {data.customerId ? (
              <Link href={`/customers/${data.customerId}`}>{data.customerName}</Link>
            ) : (
              data.customerName
            )}
          </dd>
        </div>
        <div>
          <dt>Ngân hàng</dt>
          <dd>{data.bankCode}</dd>
        </div>
        <div>
          <dt>Số tài khoản</dt>
          <dd className="tabular-nums">{formatPhone(data.accountNumber)}</dd>
        </div>
        <div>
          <dt>Mã giới thiệu</dt>
          <dd>{data.referralCode}</dd>
        </div>
        <div>
          <dt>Ngày mở</dt>
          <dd>{formatDate(data.date)}</dd>
        </div>
        <div>
          <dt>Kênh</dt>
          <dd>
            {data.channel || "Không có"}
            {data.channelDetail ? ` · ${data.channelDetail}` : ""}
          </dd>
        </div>
        <div>
          <dt>Đã cài app</dt>
          <dd>
            <StatusTag ok={data.appInstalled}>{data.appInstalled ? "Có" : "Không"}</StatusTag>
          </dd>
        </div>
        <div>
          <dt>Loại tài khoản</dt>
          <dd>{ACCOUNT_TYPE_LABEL[data.accountType]}</dd>
        </div>
        <div>
          <dt>Ngày giao dịch</dt>
          <dd>
            {data.transactionAt ? (
              formatDate(data.transactionAt)
            ) : (
              <span className="text-muted">Chưa ghi nhận</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Ghi chú</dt>
          <dd>{data.note || "—"}</dd>
        </div>
        <div>
          <dt>Người tạo</dt>
          <dd>{data.createdByName ?? "—"}</dd>
        </div>
        <div>
          <dt>Đơn vị lúc tạo</dt>
          <dd>{departmentName ?? "—"}</dd>
        </div>
      </dl>

      {/* Hai khối ảnh CHỈ XEM (chốt 2026-08-16): thêm/thay/xoá ảnh đi qua hộp
          thoại Sửa cùng với các ô còn lại, không thao tác thẳng ngoài trang. */}
      <BankAccountPhotos photos={savedPhotos(data.photoUrls)} requiredPhotos={data.requiredPhotos} />

      {/* Ảnh giao dịch của bước 3 (spec §4.2) — nộp muộn, không bắt buộc tấm
          nào, và KHÔNG cộng vào số ảnh chứng minh bắt buộc. */}
      <BankAccountPhotos
        title="Ảnh giao dịch"
        requiredPhotos={0}
        photos={savedPhotos(data.transactionPhotoUrls)}
      />

      {markingError && (
        <Dialog
          open
          title="Đánh dấu tài khoản lỗi"
          onClose={() => !statusUpdate.isPending && setMarkingError(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setMarkingError(false)} disabled={statusUpdate.isPending}>
                Huỷ
              </Button>
              <Button
                disabled={statusUpdate.isPending || errorNote.trim().length < 2}
                onClick={() => statusUpdate.mutate({ status: "error", errorNote })}
              >
                Đánh dấu lỗi
              </Button>
            </>
          }
        >
          <Alert tone="warning">Tài khoản này sẽ bị loại khỏi KPI. Quà của khách giữ nguyên.</Alert>
          <TextArea
            label="Lý do lỗi"
            required
            rows={3}
            placeholder="Ví dụ: Tài khoản không hợp lệ khi đối soát"
            value={errorNote}
            onChange={(event) => setErrorNote(event.target.value)}
          />
        </Dialog>
      )}
    </SectionCard>
  );
}

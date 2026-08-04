"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, ChevronLeft, Landmark, Trash2 } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountFinishFields } from "@/components/banking/BankAccountFinishFields";
import { BankAccountPhotos } from "@/components/banking/BankAccountPhotos";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  AccountType,
  BankAccountFinishForm,
  deleteBankAccount,
  finishBankAccount,
  setBankAccountPhotos,
} from "@/lib/api/bankAccounts";
import { fetchBankAccountDetail, type BankAccountDetail } from "@/lib/api/banking";
import { fetchDepartments } from "@/lib/api/departments";
import { formatDate, formatPhone } from "@/lib/format";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  none: "Không",
  CNKD: "CNKD",
  HKD: "HKD",
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
  const actor = useSession((s) => s.user);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-account-detail", id],
    queryFn: () => fetchBankAccountDetail(id, actor?.id ?? ""),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });
  const departmentName = departments.find((d) => d.id === data?.createdByDepartmentId)?.name;

  return (
    <>
      <TopBar title={data ? `${data.bankCode} · ${data.customerName}` : "Tài khoản ngân hàng"} />

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

        {data && data.status === "done" && (
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
  const actor = useSession((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();

  const finishForm = useForm<BankAccountFinishForm>({
    resolver: zodResolver(BankAccountFinishForm),
    defaultValues: {
      accountNumber:
        data.accountNumberMethod === "phone-match" ? data.customerPrimaryPhone : data.accountNumber,
      openedDate: data.date || new Date().toISOString().slice(0, 10),
      appInstalled: true,
      accountType: "none",
      note: data.note,
    },
  });

  const enoughPhotos = data.photoUrls.length >= data.requiredPhotos;

  // Hoàn thành/xoá đều đổi số "đang giữ · đã dùng" của mã — invalidate để hộp
  // thoại "Mở ngân hàng" không hiện số cũ tới khi hết 30s staleTime mặc định.
  const invalidateShared = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    if (data.customerId) queryClient.invalidateQueries({ queryKey: ["customer", data.customerId] });
  };

  const uploadPhotos = useMutation({
    mutationFn: (urls: string[]) => setBankAccountPhotos(id, urls, actor?.id ?? ""),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-account-detail", id] }),
  });

  const finish = useMutation({
    mutationFn: (form: BankAccountFinishForm) => finishBankAccount(id, form, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-detail", id] });
      invalidateShared();
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteBankAccount(id, actor?.id ?? ""),
    onSuccess: () => {
      invalidateShared();
      router.push(data.customerId ? `/customers/${data.customerId}` : "/banking");
    },
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

      <p className="text-muted">
        Đã mở tài khoản thật xong thì điền nốt bên dưới rồi bấm &quot;Hoàn thành&quot;.
      </p>

      {finish.isError && <Alert tone="error">Không hoàn thành được tài khoản này.</Alert>}

      <BankAccountFinishFields
        formId="finish-account-form"
        onSubmit={finishForm.handleSubmit((form) => finish.mutate(form))}
        register={finishForm.register}
        errors={finishForm.formState.errors}
        watch={finishForm.watch}
        setValue={finishForm.setValue}
        bankCode={data.bankCode}
        accountNumberMethod={data.accountNumberMethod}
        photoUrls={data.photoUrls}
        requiredPhotos={data.requiredPhotos}
        onPhotosChange={(urls) => uploadPhotos.mutate(urls)}
        photosError={uploadPhotos.isError}
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
      {!enoughPhotos && (
        <p className="text-muted">Cần đủ {data.requiredPhotos} ảnh chứng minh mới hoàn thành được.</p>
      )}
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
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();

  const uploadPhotos = useMutation({
    mutationFn: (photoUrls: string[]) => setBankAccountPhotos(id, photoUrls, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    },
  });

  return (
    <SectionCard title="Chi tiết tài khoản" icon={<Landmark size={17} />}>
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
          <dt>CNKD / HKD</dt>
          <dd>{ACCOUNT_TYPE_LABEL[data.accountType]}</dd>
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

      {uploadPhotos.isError && <Alert tone="error">Không lưu được ảnh chứng minh này.</Alert>}
      <BankAccountPhotos
        photoUrls={data.photoUrls}
        requiredPhotos={data.requiredPhotos}
        onChange={(urls) => uploadPhotos.mutate(urls)}
      />
    </SectionCard>
  );
}

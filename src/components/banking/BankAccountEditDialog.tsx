"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import {
  BankAccountFinishForm,
  finishBankAccount,
  setBankAccountPhotos,
} from "@/lib/api/bankAccounts";
import { fetchBankAccountDetail } from "@/lib/api/banking";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { can } from "@/lib/permissions";
import { businessDay } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import { BankAccountFinishFields } from "./BankAccountFinishFields";
import { BankAccountPhotos } from "./BankAccountPhotos";
import styles from "./BankAccountFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  accountId: string;
};

/**
 * Mở một tài khoản ĐÃ CÓ ngay trên bảng P-21 — không phải rời màn hình.
 *
 * Hai mặt tuỳ trạng thái, vì hai việc khác nhau:
 *  - `creating` → đây là BƯỚC 2: điền nốt STK/ngày mở/app + ảnh rồi Hoàn thành.
 *  - `done`     → chỉ còn ẢNH. Bản ghi đã hoàn thành không sửa được ngoài ảnh
 *                 (db-design §10) — nó đã tiêu một lượt mã và đã vào điểm KPI.
 *
 * Tự tải chi tiết theo `accountId` chứ không nhận sẵn từ dòng bảng: dòng bảng
 * không có `photoUrls`, `requiredPhotos` lẫn `accountNumberMethod`, mà thiếu ba
 * thứ đó thì không vẽ nổi phần ảnh. Nhồi chúng vào mọi dòng của danh sách chỉ
 * để phục vụ một hộp thoại hiếm khi mở là trả giá sai chỗ.
 *
 * KHÔNG có nút Xoá ở đây: bảng bên ngoài đã có nút xoá kèm hộp xác nhận nói rõ
 * hệ quả. Thêm đường xoá thứ hai KHÔNG hỏi lại, nằm sát nút "Đóng" trong cùng
 * thanh footer, là đặt bẫy đúng chỗ ngón tay quen bấm.
 *
 * Trang `/banking/[id]` vẫn còn và vẫn là nơi mở bằng link — hộp thoại này chỉ
 * là lối tắt, hai đường dùng chung đúng hai component `BankAccountFinishFields`
 * và `BankAccountPhotos`.
 */
export function BankAccountEditDialog({ open, onClose, accountId }: Props) {
  const user = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const canWrite = can(user, "banking", "update");

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-account-detail", accountId],
    queryFn: () => fetchBankAccountDetail(accountId),
  });

  const finishForm = useForm<BankAccountFinishForm>({
    resolver: zodResolver(BankAccountFinishForm),
    // `values` chứ không phải `defaultValues`: chi tiết về SAU lượt render đầu,
    // mà `defaultValues` chỉ đọc một lần nên form sẽ trống mãi.
    values: {
      accountNumber: data?.accountNumber || data?.customerPrimaryPhone || "",
      openedDate: data?.date || businessDay(),
      appInstalled: data?.appInstalled ?? true,
      accountType: data?.accountType ?? "none",
      note: data?.note ?? "",
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-account-detail", accountId] });
    queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    if (data?.customerId) queryClient.invalidateQueries({ queryKey: ["customer", data.customerId] });
    // Hoàn tất tài khoản là ghi điểm KPI — ba nơi hiện điểm phải hỏi lại.
    invalidateKpi(queryClient);
  };

  const savePhotos = useMutation({
    mutationFn: (urls: string[]) => setBankAccountPhotos(accountId, urls),
    onSuccess: (updated) => {
      invalidate();
      toast.ok(`Đã lưu ${updated.photoUrls.length} ảnh chứng minh`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ảnh chứng minh này.")),
  });

  const finish = useMutation({
    mutationFn: (form: BankAccountFinishForm) => finishBankAccount(accountId, form),
    onSuccess: (result) => {
      invalidate();
      onClose();
      toast.ok("Đã hoàn tất tài khoản ngân hàng");
      // Cảnh báo mềm mức khách hàng (spec §4.8) — mỗi luật một dòng, hiện SAU
      // khi đã lưu xong nên không được dùng tông lỗi.
      for (const w of result.warnings) toast.warn(w);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không hoàn tất được tài khoản này.")),
  });

  const draft = data?.status === "creating";
  const enoughPhotos = (data?.photoUrls.length ?? 0) >= (data?.requiredPhotos ?? 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={draft ? "Hoàn tất tài khoản" : "Ảnh chứng minh"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          {draft && canWrite && (
            <Button
              type="submit"
              form="edit-account-form"
              disabled={finish.isPending || !enoughPhotos}
            >
              <CheckCircle2 size={16} aria-hidden />
              Hoàn thành
            </Button>
          )}
        </>
      }
    >
      {isPending && <SkeletonCard lines={5} />}
      {isError && (
        <ErrorState what="tài khoản này" onRetry={refetch} retrying={isFetching} />
      )}

      {data && (
        <div className={styles.form}>
          <div className={styles.summary}>
            <strong>{data.bankCode}</strong> · {data.referralCode} · {data.customerName}
            {data.channel && (
              <span className="text-muted">
                {" "}
                — {data.channel}
                {data.channelDetail ? ` · ${data.channelDetail}` : ""}
              </span>
            )}
          </div>

          {draft ? (
            <>
              <BankAccountFinishFields
                formId="edit-account-form"
                onSubmit={finishForm.handleSubmit((form) => finish.mutate(form))}
                register={finishForm.register}
                errors={finishForm.formState.errors}
                watch={finishForm.watch}
                setValue={finishForm.setValue}
                bankCode={data.bankCode}
                accountNumberMethod={data.accountNumberMethod}
                photoUrls={data.photoUrls}
                requiredPhotos={data.requiredPhotos}
                onPhotosChange={(urls) => savePhotos.mutate(urls)}
              />
              {!enoughPhotos && (
                <p className="text-muted">
                  Cần đủ {data.requiredPhotos} ảnh chứng minh mới hoàn thành được.
                </p>
              )}
            </>
          ) : (
            /* Đã hoàn thành: chỉ ảnh. Số tài khoản, ngày mở và trạng thái cài
               app đều đã tính vào điểm KPI và đã tiêu một lượt mã. */
            <BankAccountPhotos
              photoUrls={data.photoUrls}
              requiredPhotos={data.requiredPhotos}
              onChange={(urls) => savePhotos.mutate(urls)}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}

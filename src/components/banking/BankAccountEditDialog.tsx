"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import {
  BankAccountFinishForm,
  finishBankAccount,
  setBankAccountPhotos,
  updateBankAccount,
} from "@/lib/api/bankAccounts";
import { fetchBankAccountDetail } from "@/lib/api/banking";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { can } from "@/lib/permissions";
import { businessDay } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import { BankAccountFinishFields } from "./BankAccountFinishFields";
import {
  photosChanged,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "./BankAccountPhotos";
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
 *                 Bấm nút là TIÊU một lượt mã giới thiệu.
 *  - `done`     → SỬA: cùng bộ ô, nhưng không đụng kho mã. Bản trước chỉ cho
 *                 thay ảnh, và đó là ngõ cụt thật — gõ nhầm số tài khoản hay
 *                 quên tích "đã cài app" thì không có đường chữa nào, vì bản
 *                 `done` cũng không xoá được.
 *
 * Khách, ngân hàng và mã giới thiệu KHÔNG sửa được ở cả hai mặt: đổi chúng là
 * viết lại lịch sử kho mã, không phải sửa một chỗ gõ nhầm.
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

  /**
   * `null` = người dùng chưa đụng vào ảnh, cứ lấy theo bản ghi. Tính khi render
   * chứ không đồng bộ bằng effect (AGENTS.md §7) — chi tiết về sau lượt render
   * đầu nên `useState(data.photoUrls)` sẽ mãi rỗng.
   */
  const [editedPhotos, setEditedPhotos] = useState<PhotoItem[] | null>(null);
  const photos = editedPhotos ?? savedPhotos(data?.photoUrls ?? []);

  /**
   * Ảnh đi trước, bản ghi đi sau — và phải ĐỦ CẢ HAI mới coi là xong.
   *
   * Máy chủ đếm ảnh trong bảng `bank_account_photos` ngay trong giao dịch hoàn
   * thành, nên tải file lên thôi chưa đủ: phải ghi danh sách URL vào bản ghi
   * trước khi gọi đường hoàn thành/sửa.
   */
  const savePhotosThen = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (photosChanged(photos, data?.photoUrls ?? [])) {
      const urls = await uploadPendingPhotos(photos);
      await setBankAccountPhotos(accountId, urls);
    }
    return run();
  };

  const finish = useMutation({
    mutationFn: (form: BankAccountFinishForm) =>
      savePhotosThen(() => finishBankAccount(accountId, form)),
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

  /**
   * Sửa bản ghi đã hoàn thành. Máy chủ tính lại điểm KPI của CẢ tháng cũ lẫn
   * tháng mới khi ngày mở đổi, và tính lại trường hợp quà khi cờ app đổi — nên
   * `invalidate()` ở đây quan trọng y như ở nhánh hoàn thành.
   */
  const update = useMutation({
    mutationFn: (form: BankAccountFinishForm) =>
      savePhotosThen(() => updateBankAccount(accountId, form)),
    onSuccess: (result) => {
      invalidate();
      onClose();
      toast.ok("Đã lưu thay đổi cho tài khoản này");
      for (const w of result.warnings) toast.warn(w);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được thay đổi cho tài khoản này.")),
  });

  const draft = data?.status === "creating";
  const enoughPhotos = photos.length >= (data?.requiredPhotos ?? 0);
  const busy = finish.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={draft ? "Hoàn tất tài khoản" : "Sửa tài khoản"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          {canWrite &&
            (draft ? (
              <Button
                type="submit"
                form="edit-account-form"
                disabled={busy || !enoughPhotos}
              >
                <CheckCircle2 size={16} aria-hidden />
                Hoàn thành
              </Button>
            ) : (
              <Button type="submit" form="edit-account-form" disabled={busy}>
                <Save size={16} aria-hidden />
                Lưu
              </Button>
            ))}
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

          {/* Cùng một bộ ô cho cả hai mặt — khác nhau ở chỗ bấm nút thì làm gì.
              Ảnh vẫn lưu ngay khi thả, không chờ nút, ở cả hai mặt. */}
          <BankAccountFinishFields
            formId="edit-account-form"
            onSubmit={
              draft
                ? finishForm.handleSubmit((form) => finish.mutate(form))
                : finishForm.handleSubmit((form) => update.mutate(form))
            }
            register={finishForm.register}
            errors={finishForm.formState.errors}
            watch={finishForm.watch}
            setValue={finishForm.setValue}
            bankCode={data.bankCode}
            accountNumberMethod={data.accountNumberMethod}
            photos={photos}
            requiredPhotos={data.requiredPhotos}
            onPhotosChange={setEditedPhotos}
            busy={busy}
          />
          {draft && !enoughPhotos && (
            <p className="text-muted">
              Cần đủ {data.requiredPhotos} ảnh chứng minh mới hoàn thành được.
            </p>
          )}
          {/* Đổi ngày mở là đổi tháng tính điểm, đổi cờ app là đổi cả combo quà
              — nói trước khi người dùng bấm, không phải sau. */}
          {!draft && (
            <p className="text-muted">
              Đổi ngày mở hoặc trạng thái cài app sẽ tính lại điểm KPI và trường hợp quà
              của khách này.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { codeStatusOf, fetchBanks, fetchReferralCodes } from "@/lib/api/bankCatalog";
import {
  BankAccountFinishForm,
  BankAccountStartForm,
  deleteBankAccount,
  finishBankAccount,
  setBankAccountPhotos,
  startBankAccount,
  type BankAccount,
} from "@/lib/api/bankAccounts";
import { useSession } from "@/store/session";
import { BankAccountFinishFields } from "./BankAccountFinishFields";
import styles from "./BankAccountFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerPrimaryPhone: string;
};

const emptyStartForm = (customerId: string): BankAccountStartForm => ({
  customerId,
  bankId: "",
  referralCode: "",
});

const emptyFinishForm: BankAccountFinishForm = {
  accountNumber: "",
  openedDate: "",
  appInstalled: true,
  accountType: "none",
  note: "",
};

/**
 * P-20 · Mở tài khoản ngân hàng cho khách — hai bước trong CÙNG một hộp
 * thoại (spec §4.2, §4.5): bước 1 chọn ngân hàng + mã, giữ chỗ ngay; bấm
 * "Tiếp tục" xong hộp thoại tự chuyển sang bước 2 (điền STK/ngày mở/ảnh) mà
 * không phải rời màn hình. Nút của cả hai bước đều nằm ở footer hộp thoại,
 * giống mọi hộp thoại khác trong app — không đặt nút hành động trong thân.
 * Đóng ở bước 2 mà chưa hoàn thành thì tài khoản vẫn ở trạng thái `creating`
 * — quay lại tiếp tục sau qua nút "Tiếp tục" trên hồ sơ khách hoặc P-22.
 */
export function BankAccountFormDialog({
  open,
  onClose,
  customerId,
  customerPrimaryPhone,
}: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = banks.filter((b) => b.active);

  /* ── Bước 1 ── */
  const startForm = useForm<BankAccountStartForm>({
    resolver: zodResolver(BankAccountStartForm),
    defaultValues: emptyStartForm(customerId),
  });

  const bankId = startForm.watch("bankId");
  const selectedBank = activeBanks.find((b) => b.id === bankId);

  const { data: codes = [] } = useQuery({
    queryKey: ["referral-codes", bankId, ""],
    queryFn: () => fetchReferralCodes({ bankId, status: "" }),
    enabled: Boolean(bankId),
  });
  const availableCodes = codes.filter((c) => codeStatusOf(c) !== "full");

  // Gợi ý sẵn mã đầu tiên còn chỗ khi đổi ngân hàng — `codes` tải xong SAU khi
  // bankId đổi (query bất đồng bộ) nên phải tách riêng effect này, khoá theo
  // cả `availableCodes.length` chứ không chỉ `bankId`.
  useEffect(() => {
    if (!bankId) return;
    startForm.setValue("referralCode", availableCodes[0]?.id ?? "", { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, availableCodes.length]);

  /* ── Bước 2 ── */
  const finishForm = useForm<BankAccountFinishForm>({
    resolver: zodResolver(BankAccountFinishForm),
    defaultValues: emptyFinishForm,
  });
  const requiredPhotos = selectedBank?.requiredPhotos ?? 0;
  const enoughPhotos = photoUrls.length >= requiredPhotos;

  const start = useMutation({
    mutationFn: (form: BankAccountStartForm) => startBankAccount(form, actor?.id ?? ""),
    onSuccess: (created) => {
      setAccount(created);
      setPhotoUrls(created.photoUrls);
      finishForm.reset({
        accountNumber:
          selectedBank?.accountNumberMethod === "phone-match"
            ? customerPrimaryPhone
            : created.accountNumber,
        openedDate: created.openedDate || new Date().toISOString().slice(0, 10),
        appInstalled: true,
        accountType: "none",
        note: created.note,
      });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    },
  });

  // Hoàn thành/xoá đều đổi số "đang giữ · đã dùng" của mã — invalidate để hộp
  // thoại "Mở ngân hàng" không hiện số cũ tới khi hết 30s staleTime mặc định.
  const invalidateAfterFinishOrDelete = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
  };

  const uploadPhotos = useMutation({
    mutationFn: (urls: string[]) => setBankAccountPhotos(account?.id ?? "", urls, actor?.id ?? ""),
    onSuccess: (updated) => setPhotoUrls(updated.photoUrls),
  });

  const finish = useMutation({
    mutationFn: (form: BankAccountFinishForm) =>
      finishBankAccount(account?.id ?? "", form, actor?.id ?? ""),
    onSuccess: () => {
      invalidateAfterFinishOrDelete();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteBankAccount(account?.id ?? "", actor?.id ?? ""),
    onSuccess: () => {
      invalidateAfterFinishOrDelete();
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={account ? "Hoàn tất tài khoản" : "Mở tài khoản ngân hàng"}
      footer={
        account ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Để sau
            </Button>
            <Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 size={16} />
              Xoá
            </Button>
            <Button
              type="submit"
              form="finish-account-form"
              disabled={finishForm.formState.isSubmitting || finish.isPending || !enoughPhotos}
            >
              <CheckCircle2 size={16} />
              Hoàn thành
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button
              type="submit"
              form="bank-account-form"
              disabled={startForm.formState.isSubmitting || start.isPending}
            >
              Tiếp tục
            </Button>
          </>
        )
      }
    >
      {account ? (
        <div className={styles.form}>
          <div className={styles.summary}>
            <strong>{account.bankCode}</strong> · {account.referralCode} · {account.customerName}
            {account.channel && (
              <span className="text-muted">
                {" "}
                — {account.channel}
                {account.channelDetail ? ` · ${account.channelDetail}` : ""}
              </span>
            )}
          </div>

          {finish.isError && <Alert tone="error">Không hoàn thành được tài khoản này.</Alert>}

          <BankAccountFinishFields
            formId="finish-account-form"
            onSubmit={finishForm.handleSubmit((form) => finish.mutate(form))}
            register={finishForm.register}
            errors={finishForm.formState.errors}
            watch={finishForm.watch}
            setValue={finishForm.setValue}
            bankCode={account.bankCode}
            accountNumberMethod={selectedBank?.accountNumberMethod ?? "manual"}
            photoUrls={photoUrls}
            requiredPhotos={requiredPhotos}
            onPhotosChange={(urls) => uploadPhotos.mutate(urls)}
            photosError={uploadPhotos.isError}
          />
          {!enoughPhotos && (
            <p className="text-muted">Cần đủ {requiredPhotos} ảnh chứng minh mới hoàn thành được.</p>
          )}
        </div>
      ) : (
        <form
          id="bank-account-form"
          className={styles.form}
          onSubmit={startForm.handleSubmit((form) => start.mutate(form))}
          noValidate
        >
          {start.isError && <Alert tone="error">Không giữ được chỗ mã này.</Alert>}

          <Select
            block
            label="Ngân hàng"
            value={bankId}
            onChange={(v) => startForm.setValue("bankId", v, { shouldDirty: true })}
            options={[
              { value: "", label: "— Chọn ngân hàng —" },
              ...activeBanks.map((b) => ({ value: b.id, label: b.code })),
            ]}
          />
          {startForm.formState.errors.bankId && (
            <p className={styles.error}>{startForm.formState.errors.bankId.message}</p>
          )}

          {bankId && (
            <>
              <Select
                block
                label="Mã giới thiệu"
                value={startForm.watch("referralCode")}
                onChange={(v) => startForm.setValue("referralCode", v, { shouldDirty: true })}
                options={
                  availableCodes.length === 0
                    ? [{ value: "", label: "— Hết mã còn chỗ —" }]
                    : availableCodes.map((c) => ({
                        value: c.id,
                        label: `${c.code} · còn ${c.total - c.used - c.holding} chỗ · đang giữ ${c.holding}`,
                      }))
                }
              />
              {startForm.formState.errors.referralCode && (
                <p className={styles.error}>{startForm.formState.errors.referralCode.message}</p>
              )}
            </>
          )}
        </form>
      )}
    </Dialog>
  );
}

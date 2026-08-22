"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, Trash2 } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { DepartmentPicker } from "@/components/layout/DepartmentPicker";
import { Select } from "@/components/ui/Select";
import { fetchBanks, fetchOpenReferralCodes } from "@/lib/api/bankCatalog";
import {
  BankAccountFinishForm,
  BankAccountStartForm,
  deleteBankAccount,
  finishBankAccount,
  setBankAccountPhotos,
  startBankAccount,
  type BankAccount,
} from "@/lib/api/bankAccounts";
import { BankAccountFinishFields } from "./BankAccountFinishFields";
import {
  photosChanged,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "./BankAccountPhotos";
import styles from "./BankAccountFormDialog.module.scss";
import { businessDay } from "@/lib/format";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  /**
   * Có khi hộp thoại này là bước 2 của `CustomerPickerDialog`. Không có khi mở
   * thẳng từ hồ sơ khách (P-40, P-42) — ở đó khách đã cố định, không có bước
   * nào để quay về.
   */
  onBack?: () => void;
};

const emptyStartForm = (customerId: string): BankAccountStartForm => ({
  customerId,
  bankId: "",
  referralCode: "",
  departmentId: "",
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
  onBack,
}: Props) {
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = banks.filter((b) => b.active);

  /* ── Bước 1 ── */
  const startForm = useForm<BankAccountStartForm>({
    resolver: zodResolver(BankAccountStartForm),
    defaultValues: emptyStartForm(customerId),
  });

  const bankId = startForm.watch("bankId");
  const selectedBank = activeBanks.find((b) => b.id === bankId);

  /**
   * Máy chủ đã lọc "còn chỗ" và lọc theo phạm vi phòng — không lọc lại ở đây
   * (AGENTS.md §5.1).
   *
   * `departmentId` chỉ có giá trị với người không thuộc phòng nào; máy chủ bỏ
   * qua nó với người có phòng và dùng phòng thật của họ. Nó nằm trong khoá
   * cache vì đổi phòng là đổi danh sách mã (spec §4.4d).
   */
  const departmentId = startForm.watch("departmentId");
  const { data: availableCodes = [] } = useQuery({
    queryKey: ["referral-codes", "open", bankId, departmentId],
    queryFn: () => fetchOpenReferralCodes(bankId, departmentId),
    enabled: Boolean(bankId),
  });

  // Gợi ý sẵn mã đầu tiên còn chỗ khi đổi ngân hàng — `codes` tải xong SAU khi
  // bankId đổi (query bất đồng bộ) nên phải tách riêng effect này, khoá theo
  // cả `availableCodes.length` chứ không chỉ `bankId`.
  useEffect(() => {
    if (!bankId) return;
    startForm.setValue("referralCode", availableCodes[0]?.id ?? "", { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, departmentId, availableCodes.length]);

  /* ── Bước 2 ── */
  const finishForm = useForm<BankAccountFinishForm>({
    resolver: zodResolver(BankAccountFinishForm),
    defaultValues: emptyFinishForm,
  });
  const requiredPhotos = selectedBank?.requiredPhotos ?? 0;
  const enoughPhotos = photos.length >= requiredPhotos;

  const start = useMutation({
    mutationFn: (form: BankAccountStartForm) => startBankAccount(form),
    onSuccess: (created) => {
      setAccount(created);
      setPhotos(savedPhotos(created.photoUrls));
      finishForm.reset({
      /**
       * Ngân hàng lấy số tài khoản theo SĐT thì điền sẵn SỐ CHÍNH — phần lớn
       * khách mở bằng số đó. Nhân viên đổi sang số phụ ngay trong ô chọn nếu
       * khách dùng số khác. `customerPhones[0]` là số chính, máy chủ đã sắp.
       *
       * Chỉ điền khi bản ghi CHƯA có số: tài khoản đang sửa mang số thật rồi
       * thì đè lên là ghi lại hợp đồng theo dữ liệu suy đoán.
       */
        accountNumber:
          created.accountNumber ||
          (selectedBank?.accountNumberMethod === "phone-match"
            ? (created.customerPhones[0] ?? "")
            : ""),
        openedDate: created.openedDate || businessDay(),
        appInstalled: true,
        accountType: "none",
        note: created.note,
      });
      // Bước 1 đã sinh ra một dòng `Đang tạo` thật trong bảng P-21, nên bảng đó
      // phải tải lại ngay — không đợi tới lúc Hoàn thành. Thiếu dòng này thì
      // người dùng đóng hộp thoại giữa chừng và không thấy bản ghi dở dang đâu.
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      // Ô lọc "Mã giới thiệu" ở P-21 và màn Xuất dữ liệu đọc key này — giữ chỗ
      // xong là số chỗ còn lại của mã đã đổi.
      queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
      toast.ok("Đã giữ chỗ mã giới thiệu — điền nốt để hoàn tất tài khoản");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không mở được tài khoản này.")),
  });

  // Hoàn thành/xoá đều đổi số "đang giữ · đã dùng" của mã — invalidate để hộp
  // thoại "Mở ngân hàng" không hiện số cũ tới khi hết 30s staleTime mặc định.
  const invalidateAfterFinishOrDelete = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
    queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    invalidateKpi(queryClient);
  };

  const finish = useMutation({
    // Ảnh đi trước, bản ghi đi sau: máy chủ đếm ảnh ngay trong giao dịch hoàn
    // thành, nên phải ghi xong danh sách URL rồi mới gọi đường hoàn thành.
    mutationFn: async (form: BankAccountFinishForm) => {
      const id = account?.id ?? "";
      if (photosChanged(photos, account?.photoUrls ?? []))
        await setBankAccountPhotos(id, await uploadPendingPhotos(photos));
      return finishBankAccount(id, form);
    },
    onSuccess: () => {
      invalidateAfterFinishOrDelete();
      onClose();
      toast.ok("Đã hoàn tất tài khoản ngân hàng");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không hoàn tất được tài khoản này.")),
  });

  const remove = useMutation({
    mutationFn: () => deleteBankAccount(account?.id ?? ""),
    onSuccess: () => {
      invalidateAfterFinishOrDelete();
      onClose();
      toast.ok("Đã xoá tài khoản đang tạo dở, mã giới thiệu được nhả lại");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được tài khoản này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={account ? "Hoàn tất tài khoản" : "Mở tài khoản ngân hàng"}
      footerStart={
        // Chỉ ở bước MỞ tài khoản. Sang bước hoàn tất thì bản ghi đã nằm trong
        // database, quay về chọn khách khác là bỏ lại một tài khoản dở dang.
        !account && onBack ? <BackButton onClick={onBack}>Chọn khách khác</BackButton> : null
      }
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


          <BankAccountFinishFields
            formId="finish-account-form"
            onSubmit={finishForm.handleSubmit((form) => finish.mutate(form))}
            register={finishForm.register}
            errors={finishForm.formState.errors}
            watch={finishForm.watch}
            setValue={finishForm.setValue}
            bankCode={account.bankCode}
            accountNumberMethod={selectedBank?.accountNumberMethod ?? "manual"}
            customerPhones={account?.customerPhones ?? []}
            referralOpenUrl={account?.referralOpenUrl ?? ""}
            photos={photos}
            requiredPhotos={requiredPhotos}
            onPhotosChange={setPhotos}
            busy={finish.isPending}
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

          <DepartmentPicker
            module="banking"
            value={startForm.watch("departmentId")}
            onChange={(v) => startForm.setValue("departmentId", v, { shouldDirty: true })}
          />

          <Select
            block
            label="Ngân hàng"
            required
            value={bankId}
            error={startForm.formState.errors.bankId?.message}
            onChange={(v) => startForm.setValue("bankId", v, { shouldDirty: true })}
            options={[
              { value: "", label: "— Chọn ngân hàng —" },
              ...activeBanks.map((b) => ({ value: b.id, label: b.code })),
            ]}
          />

          {bankId && (
            <>
              <Select
                block
                label="Mã giới thiệu"
                required
                value={startForm.watch("referralCode")}
                error={startForm.formState.errors.referralCode?.message}
                onChange={(v) => startForm.setValue("referralCode", v, { shouldDirty: true })}
                options={
                  availableCodes.length === 0
                    ? [{ value: "", label: "— Hết mã còn chỗ —" }]
                    : availableCodes.map((c) => ({
                        value: c.id,
                        // Trừ cả `holding`: tài khoản người khác đang mở dở đã
                        // chiếm chỗ rồi, không trừ là hứa thừa.
                        label: `${c.code} · còn ${c.total - c.used - c.holding} chỗ`,
                      }))
                }
              />
            </>
          )}
        </form>
      )}
    </Dialog>
  );
}

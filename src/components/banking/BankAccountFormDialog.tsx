"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { codeStatusOf, fetchBanks, fetchReferralCodes } from "@/lib/api/bankCatalog";
import {
  AccountType,
  BankAccountForm,
  createBankAccount,
  type CreateBankAccountResult,
} from "@/lib/api/bankAccounts";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { fetchHospitals } from "@/lib/api/hospitalCatalog";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { useSession } from "@/store/session";
import styles from "./BankAccountFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerPrimaryPhone: string;
};

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  none: "Không",
  CNKD: "CNKD",
  HKD: "HKD",
};

const emptyForm = (phone: string): BankAccountForm => ({
  customerId: "",
  bankId: "",
  referralCode: "",
  accountNumber: phone,
  openedDate: new Date().toISOString().slice(0, 10),
  channel: "",
  channelDetail: "",
  appInstalled: true,
  accountType: "none",
  photosConfirmed: false,
  note: "",
});

/**
 * P-20 · Mở tài khoản ngân hàng cho khách — dùng chung ở P-42 và (sau này) ở
 * màn Ngân hàng, không sửa khi P-20 có trang riêng.
 */
export function BankAccountFormDialog({
  open,
  onClose,
  customerId,
  customerPrimaryPhone,
}: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = banks.filter((b) => b.active);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BankAccountForm>({
    resolver: zodResolver(BankAccountForm),
    defaultValues: { ...emptyForm(customerPrimaryPhone), customerId },
  });

  const bankId = watch("bankId");
  const channel = watch("channel");
  const selectedBank = activeBanks.find((b) => b.id === bankId);

  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });
  const selectedChannel = channels.find((c) => c.name === channel);

  const { data: provinces = [] } = useQuery({
    queryKey: ["provinces"],
    queryFn: fetchProvinces,
    enabled: selectedChannel?.inputKind === "ward-hamlet",
  });
  const [provinceId, setProvinceId] = useState("");
  const [wardId, setWardId] = useState("");
  const [hamletId, setHamletId] = useState("");
  const selectedProvince = provinces.find((p) => p.id === provinceId);
  const selectedWard = selectedProvince?.wards.find((w) => w.id === wardId);

  const { data: hospitals = [] } = useQuery({
    queryKey: ["hospitals"],
    queryFn: fetchHospitals,
    enabled: selectedChannel?.inputKind === "hospital",
  });

  const { data: codes = [] } = useQuery({
    queryKey: ["referral-codes", bankId, ""],
    queryFn: () => fetchReferralCodes({ bankId, status: "" }),
    enabled: Boolean(bankId),
  });
  const availableCodes = codes.filter((c) => codeStatusOf(c) !== "full");

  // Đổi ngân hàng thì tự điền số tài khoản theo đúng cách lấy STK của ngân
  // hàng đó (spec §4.2).
  useEffect(() => {
    if (!selectedBank) return;
    if (selectedBank.accountNumberMethod === "phone-match") {
      setValue("accountNumber", customerPrimaryPhone, { shouldDirty: true });
    } else {
      setValue("accountNumber", "", { shouldDirty: true });
    }
    if (selectedBank.code !== "VPa") {
      setValue("accountType", "none", { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  // Gợi ý sẵn mã đầu tiên còn chỗ — TÁCH RIÊNG effect trên: `codes` tải xong
  // SAU khi bankId đổi (query bất đồng bộ), effect gộp chung `[bankId]` sẽ
  // set "" trước rồi không bao giờ chạy lại khi mã đã tải xong. Ô chọn khi đó
  // NHÌN như đã chọn mã đầu (select tự rơi vào option đầu tiên khi value
  // không khớp), nhưng state thật vẫn rỗng — bấm Lưu báo "Chưa chọn mã".
  useEffect(() => {
    if (!bankId) return;
    setValue("referralCode", availableCodes[0]?.id ?? "", { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, availableCodes.length]);

  const save = useMutation({
    mutationFn: (form: BankAccountForm) => createBankAccount(form, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mở tài khoản ngân hàng"
      footer={
        save.data ? (
          <Button onClick={onClose}>Đóng</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button
              type="submit"
              form="bank-account-form"
              disabled={isSubmitting || save.isPending}
            >
              Lưu tài khoản
            </Button>
          </>
        )
      }
    >
      {save.data ? (
        <SavedResult result={save.data} />
      ) : (
        <form
          id="bank-account-form"
          className={styles.form}
          onSubmit={handleSubmit((form) => save.mutate(form))}
          noValidate
        >
          {save.isError && <Alert tone="error">Không lưu được tài khoản này.</Alert>}

          <Select
            block
            label="Ngân hàng"
            value={bankId}
            onChange={(v) => setValue("bankId", v, { shouldDirty: true })}
            options={[
              { value: "", label: "— Chọn ngân hàng —" },
              ...activeBanks.map((b) => ({ value: b.id, label: b.code })),
            ]}
          />
          {errors.bankId && <p className={styles.error}>{errors.bankId.message}</p>}

          {bankId && (
            <>
              <Select
                block
                label="Mã giới thiệu"
                value={watch("referralCode")}
                onChange={(v) => setValue("referralCode", v, { shouldDirty: true })}
                options={
                  availableCodes.length === 0
                    ? [{ value: "", label: "— Hết mã còn chỗ —" }]
                    : availableCodes.map((c) => ({
                        value: c.id,
                        label: `${c.code} · còn ${c.total - c.used} chỗ · đang giữ ${c.holding}`,
                      }))
                }
              />
              {errors.referralCode && (
                <p className={styles.error}>{errors.referralCode.message}</p>
              )}

              <div className={styles.pair}>
                <TextField
                  label="Số tài khoản"
                  disabled={selectedBank?.accountNumberMethod === "phone-match"}
                  hint={
                    selectedBank?.accountNumberMethod === "phone-match"
                      ? "Tự điền theo SĐT chính, không sửa được"
                      : undefined
                  }
                  error={errors.accountNumber?.message}
                  {...register("accountNumber")}
                />
                <TextField
                  label="Ngày mở"
                  type="date"
                  error={errors.openedDate?.message}
                  {...register("openedDate")}
                />
              </div>

              <Select
                block
                label="Kênh"
                value={channel}
                onChange={(v) => {
                  setValue("channel", v, { shouldDirty: true });
                  setValue("channelDetail", "", { shouldDirty: true });
                  setProvinceId("");
                  setWardId("");
                  setHamletId("");
                }}
                options={[
                  { value: "", label: "Không có" },
                  ...channels.map((c) => ({ value: c.name, label: c.name })),
                ]}
              />

              {selectedChannel?.inputKind === "ward-hamlet" && (
                <>
                  <Select
                    block
                    label="Tỉnh/thành phố"
                    value={provinceId}
                    onChange={(v) => {
                      setProvinceId(v);
                      setWardId("");
                      setHamletId("");
                      setValue("channelDetail", "", { shouldDirty: true });
                    }}
                    options={[
                      { value: "", label: "— Chọn tỉnh/thành phố —" },
                      ...provinces.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                  {selectedProvince && (
                    <Combobox
                      block
                      label="Xã/phường"
                      placeholder="Gõ để tìm xã/phường…"
                      value={wardId}
                      onChange={(v) => {
                        setWardId(v);
                        setHamletId("");
                        setValue("channelDetail", "", { shouldDirty: true });
                      }}
                      options={selectedProvince.wards.map((w) => ({ value: w.id, label: w.name }))}
                    />
                  )}
                  {selectedWard && (
                    <Select
                      block
                      label="Ấp"
                      value={hamletId}
                      onChange={(v) => {
                        setHamletId(v);
                        const hamlet = selectedWard.hamlets.find((h) => h.id === v);
                        setValue(
                          "channelDetail",
                          hamlet
                            ? `${selectedProvince?.name} · ${selectedWard.name} · ${hamlet.name}`
                            : "",
                          { shouldDirty: true },
                        );
                      }}
                      options={[
                        { value: "", label: "— Chọn ấp —" },
                        ...selectedWard.hamlets.map((h) => ({ value: h.id, label: h.name })),
                      ]}
                    />
                  )}
                </>
              )}

              {selectedChannel?.inputKind === "hospital" && (
                <Combobox
                  block
                  label="Bệnh viện"
                  placeholder="Gõ để tìm bệnh viện…"
                  value={watch("channelDetail")}
                  onChange={(v) => setValue("channelDetail", v, { shouldDirty: true })}
                  options={hospitals.map((h) => ({ value: h.name, label: h.name }))}
                />
              )}

              {selectedChannel?.inputKind === "free-text" && (
                <TextField label="Chi tiết kênh" {...register("channelDetail")} />
              )}

              {selectedBank?.code === "VPa" && (
                <Select
                  block
                  label="Mở tài khoản CNKD / HKD"
                  value={watch("accountType")}
                  onChange={(v) => setValue("accountType", v as AccountType, { shouldDirty: true })}
                  options={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              )}

              <Checkbox
                label="Khách đã cài app ngân hàng trên điện thoại"
                checked={watch("appInstalled")}
                onCheckedChange={(v) => setValue("appInstalled", v, { shouldDirty: true })}
              />

              <Checkbox
                label={`Đã đủ ${selectedBank?.requiredPhotos ?? 0} ảnh chứng minh theo cấu hình`}
                checked={watch("photosConfirmed")}
                onCheckedChange={(v) => setValue("photosConfirmed", v, { shouldDirty: true })}
              />
              {errors.photosConfirmed && (
                <p className={styles.error}>{errors.photosConfirmed.message}</p>
              )}

              <TextField label="Ghi chú" {...register("note")} />
            </>
          )}
        </form>
      )}
    </Dialog>
  );
}

function SavedResult({ result }: { result: CreateBankAccountResult }) {
  return (
    <div className={styles.result}>
      <Alert tone="info">
        Đã lưu tài khoản {result.account.bankCode} · {result.account.accountNumber}.
      </Alert>
      {result.warnings.map((w, i) => (
        <Alert key={i} tone="warning">
          {w}
        </Alert>
      ))}
    </div>
  );
}

"use client";

import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { AccountType, BankAccountFinishForm } from "@/lib/api/bankAccounts";
import type { AccountNumberMethod } from "@/lib/api/bankCatalog";
import { BankAccountPhotos } from "./BankAccountPhotos";
import styles from "./BankAccountFinishFields.module.scss";

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  none: "Không",
  CNKD: "CNKD",
  HKD: "HKD",
};

type Props = {
  formId: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  register: UseFormRegister<BankAccountFinishForm>;
  errors: FieldErrors<BankAccountFinishForm>;
  watch: UseFormWatch<BankAccountFinishForm>;
  setValue: UseFormSetValue<BankAccountFinishForm>;
  bankCode: string;
  accountNumberMethod: AccountNumberMethod;
  photoUrls: string[];
  requiredPhotos: number;
  onPhotosChange: (photoUrls: string[]) => void;
  photosError?: boolean;
};

/**
 * Bước 2 (spec §4.2, §4.5) — điền nốt sau khi KD đã mở tài khoản thật ở
 * ngoài. Chỉ vẽ FORM + ẢNH, không tự giữ mutation/nút bấm — nơi gọi (hộp
 * thoại P-20 hay trang P-22) tự quản state đó để đặt nút Hoàn thành/Xoá
 * đúng chỗ của mình (footer hộp thoại khác với hàng nút cuối trang).
 */
export function BankAccountFinishFields({
  formId,
  onSubmit,
  register,
  errors,
  watch,
  setValue,
  bankCode,
  accountNumberMethod,
  photoUrls,
  requiredPhotos,
  onPhotosChange,
  photosError,
}: Props) {
  return (
    <>
      <form id={formId} className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.formFields}>
          <TextField
            label="Số tài khoản"
            disabled={accountNumberMethod === "phone-match"}
            hint={
              accountNumberMethod === "phone-match"
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

        {bankCode === "VPa" && (
          <Select
            block
            label="Mở tài khoản CNKD / HKD"
            value={watch("accountType")}
            onChange={(v) => setValue("accountType", v as AccountType, { shouldDirty: true })}
            options={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          />
        )}

        <Checkbox
          label="Khách đã cài app ngân hàng trên điện thoại"
          checked={watch("appInstalled")}
          onCheckedChange={(v) => setValue("appInstalled", v, { shouldDirty: true })}
        />

        <TextField label="Ghi chú" {...register("note")} />
      </form>

      {photosError && <Alert tone="error">Không lưu được ảnh chứng minh này.</Alert>}
      <BankAccountPhotos photoUrls={photoUrls} requiredPhotos={requiredPhotos} onChange={onPhotosChange} />
    </>
  );
}

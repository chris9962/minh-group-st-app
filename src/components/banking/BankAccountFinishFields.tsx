"use client";

import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { AccountType, BankAccountFinishForm } from "@/lib/api/bankAccounts";
import type { AccountNumberMethod } from "@/lib/api/bankCatalog";
import { BankAccountPhotos, type PhotoItem } from "./BankAccountPhotos";
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
  /** Mọi SĐT của khách, số chính đứng đầu — nguồn cho ô chọn khi `phone-match`. */
  customerPhones: string[];
  photos: PhotoItem[];
  requiredPhotos: number;
  onPhotosChange: (photos: PhotoItem[]) => void;
  /** Đang gửi biểu mẫu — khoá phần ảnh để không ai đổi giữa chừng. */
  busy?: boolean;
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
  customerPhones,
  photos,
  requiredPhotos,
  onPhotosChange,
  busy = false,
}: Props) {
  return (
    <>
      <form id={formId} className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.formFields}>
          {/*
            Ngân hàng lấy số tài khoản THEO SĐT thì số đó phải là một trong các
            số của khách — nhưng KHÔNG nhất thiết là số chính. Khách mở tài
            khoản bằng số phụ là chuyện thường, nên đây là ô CHỌN chứ không phải
            ô khoá tự điền: áp cứng số chính là ghi sai số tài khoản vào hợp
            đồng, mà bản ghi đã `done` thì không sửa được nữa.
          */}
          {accountNumberMethod === "phone-match" ? (
            <Select
              block
              required
              label="Số tài khoản"
              value={watch("accountNumber")}
              error={errors.accountNumber?.message}
              onChange={(v) => setValue("accountNumber", v, { shouldDirty: true })}
              options={[
                { value: "", label: "— Chọn số điện thoại —" },
                ...customerPhones.map((phone, i) => ({
                  value: phone,
                  label: i === 0 ? `${phone} · SĐT chính` : phone,
                })),
              ]}
            />
          ) : (
            <TextField
              label="Số tài khoản"
              required
              error={errors.accountNumber?.message}
              {...register("accountNumber")}
            />
          )}
          <TextField
            label="Ngày mở"
            type="date"
            required
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

      <BankAccountPhotos
        photos={photos}
        requiredPhotos={requiredPhotos}
        onChange={onPhotosChange}
        busy={busy}
      />
    </>
  );
}

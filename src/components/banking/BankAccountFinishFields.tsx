"use client";

import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { useState } from "react";
import { BookOpen, ExternalLink, QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { BankGuideDialog } from "./BankGuideDialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
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
  /** Link mở tài khoản của mã giới thiệu; `''` = không dựng nút. */
  referralOpenUrl: string;
  /** Ảnh QR của mã giới thiệu; `''` = không dựng nút xem. */
  referralQrUrl: string;
  /** Hướng dẫn mở tài khoản của ngân hàng; `''` = không dựng nút xem. */
  bankGuide: string;
  /** Ảnh mẫu kèm hướng dẫn, đúng thứ tự người nhập xếp. */
  bankGuidePhotoUrls: string[];
  photos: PhotoItem[];
  requiredPhotos: number;
  /**
   * Không truyền = khối ảnh CHỈ XEM. Bản ghi đã hoàn thành quá ngày rơi vào
   * mặt này (`canEditOpeningPhotos`) — các ô chữ vẫn sửa được.
   */
  onPhotosChange?: (photos: PhotoItem[]) => void;
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
  referralOpenUrl,
  referralQrUrl,
  bankGuide,
  bankGuidePhotoUrls,
  photos,
  requiredPhotos,
  onPhotosChange,
  busy = false,
}: Props) {
  /** Đang mở ảnh QR cỡ lớn. */
  const [qrOpen, setQrOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  /**
   * Có ảnh mẫu mà chưa có chữ vẫn dựng nút — ảnh chụp từng bước tự nó đã là
   * hướng dẫn, và hộp thoại nói rõ phần chữ còn trống.
   */
  const hasGuide = Boolean(bankGuide) || bankGuidePhotoUrls.length > 0;

  return (
    <>
      {/*
        NÚT "Mở app ngân hàng", không phải tab tự mở (spec §4.4b, chốt 2026-08-19).

        Link trong QR là deep link của ngân hàng: trên điện thoại nó mở thẳng app
        nếu máy đã cài, không thì trình duyệt mở trang tải app. Đó là lý do nhãn
        nói "app" chứ không nói "trang".

        Ba lý do. Đội kinh doanh làm trên điện thoại, nơi tab mới là chuyển hẳn
        cửa sổ và đường quay lại hộp thoại đang mở dở không rõ ràng. Nhân viên có
        thể chưa muốn mở ngay — đang nói với khách, hoặc vừa chọn nhầm mã. Và
        trình duyệt CHẶN `window.open` chạy sau `await`, nên đường tự mở phải mở
        một tab trống trước rồi gán địa chỉ sau; nút bấm nằm trong đúng lượt
        tương tác nên không dính chuyện đó.

        `rel="noreferrer"`: trang mở ra ở tab mới không được chạm tới
        `window.opener` của app này.
      */}
      {(referralOpenUrl || referralQrUrl || hasGuide) && (
        <div className={styles.openRow}>
          {referralOpenUrl && (
            <Button
              variant="secondary"
              type="button"
              onClick={() => window.open(referralOpenUrl, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink size={16} aria-hidden />
              Mở app ngân hàng
            </Button>
          )}

          {/*
            Nút thứ hai cho ca khách tự quét. Nút bên trái mở app trên máy NHÂN
            VIÊN — muốn khách mở trên máy họ thì phải có tấm ảnh để chìa ra, mà
            mã QR đọc bằng mắt thì không đọc được.
          */}
          {referralQrUrl && (
            <Button variant="secondary" type="button" onClick={() => setQrOpen(true)}>
              <QrCode size={16} aria-hidden />
              Xem mã QR
            </Button>
          )}

          {/*
            Mỗi ngân hàng một quy trình: ngân hàng này bắt nhập mã giới thiệu ở
            bước định danh, ngân hàng kia đòi hai giao dịch sau khi mở. Nhân viên
            nhớ sai là tài khoản không được duyệt, mà họ đang đứng trước khách.
          */}
          {hasGuide && (
            <Button variant="secondary" type="button" onClick={() => setGuideOpen(true)}>
              <BookOpen size={16} aria-hidden />
              Xem hướng dẫn
            </Button>
          )}
        </div>
      )}

      {guideOpen && (
        <BankGuideDialog
          open
          onClose={() => setGuideOpen(false)}
          bankCode={bankCode}
          guide={bankGuide}
          photoUrls={bankGuidePhotoUrls}
        />
      )}

      {qrOpen && (
        <ImageLightbox
          src={referralQrUrl}
          alt="Mã QR mở tài khoản"
          onClose={() => setQrOpen(false)}
        />
      )}

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
            /* Giữ `type="text"`: ô `number` cắt số 0 đầu của số tài khoản.
               `inputMode` mở bàn phím số, `pattern` cho Safari cũ. */
            <TextField
              label="Số tài khoản"
              required
              inputMode="numeric"
              pattern="[0-9]*"
              error={errors.accountNumber?.message}
              {...register("accountNumber")}
            />
          )}
          <DateField
            label="Ngày mở"
            required
            error={errors.openedDate?.message}
            value={watch("openedDate")}
            onChange={(v) => setValue("openedDate", v, { shouldDirty: true, shouldValidate: true })}
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

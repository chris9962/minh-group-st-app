"use client";

import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { BankGuideDialog } from "./BankGuideDialog";
import { CharCount } from "@/components/ui/CharCount";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { BankAccountFinishForm } from "@/lib/api/bankAccounts";
import type { AccountNumberMethod } from "@/lib/api/bankCatalog";
import { BankAccountPhotos, type PhotoItem } from "./BankAccountPhotos";
import { httpLinkIn, readQrImageUrl } from "@/lib/readQrImage";
import styles from "./BankAccountFinishFields.module.scss";

type Props = {
  formId: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  register: UseFormRegister<BankAccountFinishForm>;
  errors: FieldErrors<BankAccountFinishForm>;
  watch: UseFormWatch<BankAccountFinishForm>;
  setValue: UseFormSetValue<BankAccountFinishForm>;
  bankCode: string;
  accountNumberMethod: AccountNumberMethod;
  /** Độ dài số tài khoản khi gõ tay — tổng, tính cả tiền tố; null = không kiểm. */
  accountNumberLength: number | null;
  /** Mọi SĐT của khách, số chính đứng đầu — nguồn cho ô chọn khi `phone-match`. */
  customerPhones: string[];
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
  accountNumberLength,
  customerPhones,
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
   * Kết quả giải ảnh QR, kèm URL của tấm ảnh đã giải. Giữ URL để lượt sửa nào
   * đổi sang mã giới thiệu khác thì link cũ không còn được nhận.
   */
  const [decodedQr, setDecodedQr] = useState({ url: "", link: "" });

  /**
   * Giải ảnh QR khi người dùng phóng to nó, không giải sẵn lúc mở màn.
   *
   * Link chỉ hiện trong lượt xem cỡ lớn, mà giải ảnh phải tải thêm `jsqr` và
   * chính tấm ảnh — đội kinh doanh dùng 4G ngoài trời, đa số lượt vào màn này
   * không mở QR.
   */
  useEffect(() => {
    if (!qrOpen || !referralQrUrl || decodedQr.url === referralQrUrl) return;

    let live = true;
    readQrImageUrl(referralQrUrl).then((r) => {
      if (live) setDecodedQr({ url: referralQrUrl, link: r.ok ? httpLinkIn(r.text) : "" });
    });
    return () => {
      live = false;
    };
  }, [qrOpen, referralQrUrl, decodedQr.url]);

  const qrLink = decodedQr.url === referralQrUrl ? decodedQr.link : "";

  /**
   * Có ảnh mẫu mà chưa có chữ vẫn dựng nút — ảnh chụp từng bước tự nó đã là
   * hướng dẫn, và hộp thoại nói rõ phần chữ còn trống.
   */
  const hasGuide = Boolean(bankGuide) || bankGuidePhotoUrls.length > 0;

  return (
    <>
      {(referralQrUrl || hasGuide) && (
        <div className={styles.openRow}>
          {referralQrUrl && (
            <Button variant="secondary" type="button" className={styles.openAction} onClick={() => setQrOpen(true)}>
              <QrCode size={16} aria-hidden />
              Hiện QR giới thiệu
            </Button>
          )}

          {/*
            Mỗi ngân hàng một quy trình: ngân hàng này bắt nhập mã giới thiệu ở
            bước định danh, ngân hàng kia đòi hai giao dịch sau khi mở. Nhân viên
            nhớ sai là tài khoản không được duyệt, mà họ đang đứng trước khách.
          */}
          {hasGuide && (
            <Button variant="secondary" type="button" className={styles.openAction} onClick={() => setGuideOpen(true)}>
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
          alt="Mã QR giới thiệu"
          onClose={() => setQrOpen(false)}
          caption={
            qrLink ? (
              <a href={qrLink} target="_blank" rel="noreferrer">
                <ExternalLink size={16} aria-hidden />
                Quét QR code
              </a>
            ) : undefined
          }
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
              maxLength={accountNumberLength ?? undefined}
              labelAppend={
                accountNumberLength ? (
                  <CharCount value={watch("accountNumber")} max={accountNumberLength} />
                ) : undefined
              }
              hint={accountNumberLength ? `Đủ ${accountNumberLength} chữ số.` : undefined}
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

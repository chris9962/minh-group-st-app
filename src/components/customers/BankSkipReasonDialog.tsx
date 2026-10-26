"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  BankAccountPhotos,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "@/components/banking/BankAccountPhotos";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import {
  BankSkipReasonForm,
  MAX_BANK_SKIP_REASON_PHOTOS,
  saveBankSkipReason,
  SKIP_REASON_BANK_CODE,
  type BankSkipReason,
} from "@/lib/api/customers";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./BankSkipReasonDialog.module.scss";

const NoteForm = BankSkipReasonForm.pick({ note: true });
type NoteForm = z.infer<typeof NoteForm>;

type Props = {
  customerId: string;
  /** Có thì là form sửa lý do đã ghi. */
  reason?: BankSkipReason | null;
  submitLabel: string;
  onBack?: () => void;
  /** Việc nối tiếp sau khi lưu đang chạy, ví dụ tạo tài khoản. */
  busy?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Lý do không mở ngân hàng bắt buộc (chốt 2026-10-26): ghi chú và 1 đến 3 ảnh.
 * Dùng ở form Tạo ngân hàng, lúc Tặng quà và ở hồ sơ khách.
 */
export function BankSkipReasonDialog({
  customerId,
  reason,
  submitLabel,
  onBack,
  busy = false,
  onClose,
  onSaved,
}: Props) {
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<PhotoItem[]>(() => savedPhotos(reason?.photoUrls ?? []));
  const [submitted, setSubmitted] = useState(false);
  const photoMissing = submitted && photos.length === 0;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NoteForm>({
    shouldFocusError: false,
    resolver: zodResolver(NoteForm),
    defaultValues: { note: reason?.note ?? "" },
  });

  const save = useMutation({
    mutationFn: async ({ note }: NoteForm) => {
      // Ảnh lên kho TRƯỚC, ghi lý do SAU — xem chú thích ở `BankAccountPhotos`.
      const photoUrls = await uploadPendingPhotos(photos, "bank-skip-reasons");
      setPhotos(savedPhotos(photoUrls));
      return saveBankSkipReason(customerId, { note, photoUrls });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customer-bank-slots", customerId] });
      onSaved();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được lý do.")),
  });

  const pending = save.isPending || busy;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    setSubmitted(true);
    void handleSubmit((form) => {
      if (photos.length > 0) save.mutate(form);
    }, reportInvalid)(event);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      // Lưu xong là tạo tài khoản ngay, nên không cho đóng hay quay lại giữa chừng.
      dismissible={!pending}
      title={`Lý do không mở ${SKIP_REASON_BANK_CODE}`}
      footerStart={
        onBack && (
          <BackButton onClick={onBack} disabled={pending}>
            Chọn lại ngân hàng
          </BackButton>
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Huỷ
          </Button>
          <Button type="submit" form="bank-skip-reason-form" disabled={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="bank-skip-reason-form" className={styles.form} onSubmit={submit} noValidate>
        <BankAccountPhotos
          title="Ảnh"
          required
          requiredPhotos={0}
          max={MAX_BANK_SKIP_REASON_PHOTOS}
          small
          contain
          photos={photos}
          onChange={setPhotos}
          busy={pending}
        />
        {photoMissing && (
          <p role="alert" className={styles.error}>
            Thêm ít nhất 1 ảnh
          </p>
        )}
        <TextArea
          label="Lý do"
          required
          rows={4}
          maxLength={2000}
          disabled={pending}
          error={errors.note?.message}
          {...register("note")}
        />
      </form>
    </Dialog>
  );
}

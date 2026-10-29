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
import { NoteSuggestions } from "@/components/ui/NoteSuggestions";
import { TextArea } from "@/components/ui/TextArea";
import {
  BankSkipReasonForm,
  MAX_BANK_SKIP_REASON_PHOTOS,
  saveBankSkipReason,
  type BankSkipReason,
} from "@/lib/api/customers";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./BankSkipReasonDialog.module.scss";

const NoteForm = BankSkipReasonForm.pick({ note: true });
type NoteForm = z.infer<typeof NoteForm>;

type Props = {
  customerId: string;
  /** Có khi ghi lý do cho hồ sơ khác hồ sơ đang mở. */
  customerName?: string;
  /** Bank ưu tiên chưa mở, máy chủ tự lưu kèm lý do. */
  bankCodes: string[];
  /** Có thì là form sửa lý do đã ghi. */
  reason?: BankSkipReason | null;
  submitLabel: string;
  onBack?: () => void;
  backLabel?: string;
  /** Việc nối tiếp sau khi lưu đang chạy, ví dụ chờ danh sách tải lại. */
  busy?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Lý do không mở bank ưu tiên (chốt 2026-10-29): ghi chú và 1 đến 3 ảnh.
 * Dùng lúc mở tài khoản, lúc Tặng quà và ở hồ sơ khách.
 */
export function BankSkipReasonDialog({
  customerId,
  customerName,
  bankCodes,
  reason,
  submitLabel,
  onBack,
  backLabel = "Quay lại",
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
    watch,
    setValue,
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
      // Form mở tài khoản của khách KHÁC đọc danh sách hồ sơ thiếu lý do qua key này.
      queryClient.invalidateQueries({ queryKey: ["customer-bank-slots"] });
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
      dismissible={!pending}
      title="Lý do không mở bank ưu tiên"
      footerStart={
        onBack && (
          <BackButton onClick={onBack} disabled={pending}>
            {backLabel}
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
        <dl className={styles.info}>
          {customerName && (
            <div>
              <dt>Khách</dt>
              <dd>{customerName}</dd>
            </div>
          )}
          <div>
            <dt>Bank ưu tiên chưa mở</dt>
            <dd>{bankCodes.join(", ")}</dd>
          </div>
        </dl>
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
        {!pending && (
          <NoteSuggestions
            value={watch("note")}
            options={bankCodes.flatMap((code) => [
              `Lỗi không cài được ${code}`,
              `Khách đã có ${code}`,
            ])}
            onChange={(note) =>
              setValue("note", note, { shouldDirty: true, shouldValidate: submitted })
            }
            fieldLabel="lý do"
          />
        )}
      </form>
    </Dialog>
  );
}

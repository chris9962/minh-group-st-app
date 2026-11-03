"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BankAccountPhotos,
  photosChanged,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "@/components/banking/BankAccountPhotos";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import {
  markCustomerInspected,
  updateCustomerInspectionNote,
  type CustomerDetail,
  type CustomerInspection,
} from "@/lib/api/customers";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./CustomerInspectionDialog.module.scss";

export type InspectionDialogMode = "mark" | "note";

const TITLE: Record<InspectionDialogMode, string> = {
  mark: "Đã kiểm tra",
  note: "Sửa ghi chú và ảnh",
};

/**
 * Phòng Thanh tra đánh dấu hồ sơ đã kiểm tra (`mark`) hoặc sửa ghi chú và ảnh
 * của dấu đang có (`note`). Ghi chú và ảnh đều không bắt buộc, ảnh tối đa một tấm.
 */
export function CustomerInspectionDialog({
  id,
  mode,
  note,
  photoUrl,
  onClose,
}: {
  id: string;
  mode: InspectionDialogMode;
  note: string;
  photoUrl: string | null;
  onClose: () => void;
}) {
  const savedUrls = photoUrl ? [photoUrl] : [];
  const [draft, setDraft] = useState(note);
  const [photos, setPhotos] = useState<PhotoItem[]>(() => savedPhotos(savedUrls));
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async (): Promise<CustomerInspection> => {
      // Ảnh lên kho TRƯỚC, ghi dấu SAU — xem chú thích ở `BankAccountPhotos`.
      const urls = await uploadPendingPhotos(photos, "customer-inspections");
      setPhotos(savedPhotos(urls));
      const form = { note: draft, photoUrl: urls[0] ?? null };
      return mode === "note" ? updateCustomerInspectionNote(id, form) : markCustomerInspected(id, form);
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData<CustomerDetail>(["customer", id], (previous) =>
        previous ? { ...previous, customer: { ...previous.customer, inspection: saved } } : previous,
      );
      toast.ok(mode === "note" ? "Đã lưu" : "Đã đánh dấu kiểm tra");
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer", id] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
      ]);
    },
    onError: (error) =>
      toast.fail(errorMessage(error, mode === "note" ? "Không lưu được" : "Không đánh dấu được")),
  });

  const close = () => {
    if (!save.isPending) onClose();
  };

  const unchanged = draft === note && !photosChanged(photos, savedUrls);

  return (
    <Dialog
      open
      title={TITLE[mode]}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>Huỷ</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || (mode === "note" && unchanged)}
          >
            {save.isPending ? "Đang lưu…" : "Lưu"}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <BankAccountPhotos
          title="Ảnh"
          requiredPhotos={0}
          max={1}
          small
          contain
          photos={photos}
          onChange={setPhotos}
          busy={save.isPending}
        />
        <TextArea
          label="Ghi chú"
          rows={4}
          maxLength={500}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={save.isPending}
          placeholder="Nhập ghi chú kiểm tra…"
          hint={`${draft.length}/500 ký tự`}
        />
      </div>
    </Dialog>
  );
}

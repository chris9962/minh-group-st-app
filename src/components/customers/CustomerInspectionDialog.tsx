"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

export type InspectionDialogMode = "mark" | "recheck" | "note";

const TITLE: Record<InspectionDialogMode, string> = {
  mark: "Đã kiểm tra",
  recheck: "Đã kiểm tra lại",
  note: "Sửa ghi chú kiểm tra",
};

/**
 * Phòng Thanh tra đánh dấu hồ sơ đã kiểm tra (`mark`), kiểm tra lại sau khi hồ
 * sơ có thay đổi (`recheck`, cùng đường ghi với `mark`), hoặc sửa ghi chú của
 * dấu đang có (`note`). Ghi chú không bắt buộc.
 */
export function CustomerInspectionDialog({
  id,
  mode,
  note,
  onClose,
}: {
  id: string;
  mode: InspectionDialogMode;
  note: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(note);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (): Promise<CustomerInspection> =>
      mode === "note" ? updateCustomerInspectionNote(id, draft) : markCustomerInspected(id, draft),
    onSuccess: async (saved) => {
      queryClient.setQueryData<CustomerDetail>(["customer", id], (previous) =>
        previous ? { ...previous, customer: { ...previous.customer, inspection: saved } } : previous,
      );
      toast.ok(mode === "note" ? "Đã lưu ghi chú" : "Đã đánh dấu kiểm tra");
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer", id] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
      ]);
    },
    onError: (error) =>
      toast.fail(errorMessage(error, mode === "note" ? "Không lưu được ghi chú" : "Không đánh dấu được")),
  });

  const close = () => {
    if (!save.isPending) onClose();
  };

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
            disabled={save.isPending || (mode === "note" && draft === note)}
          >
            {save.isPending ? "Đang lưu…" : "Lưu"}
          </Button>
        </>
      }
    >
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
    </Dialog>
  );
}

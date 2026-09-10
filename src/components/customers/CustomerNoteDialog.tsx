"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { updateCustomerNote, type CustomerDetail } from "@/lib/api/customers";
import { errorMessage, toast } from "@/lib/toast";

/** Chỉ mở ô nhập khi người dùng chủ động sửa; nội dung thường nằm ở khối Thông tin. */
export function CustomerNoteDialog({
  id,
  note,
  onClose,
}: {
  id: string;
  note: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(note);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => updateCustomerNote(id, draft),
    onSuccess: async (saved) => {
      queryClient.setQueryData<CustomerDetail>(["customer", id], (previous) => previous ? {
        ...previous,
        customer: { ...previous.customer, note: saved.note },
      } : previous);
      toast.ok("Đã lưu ghi chú");
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
    onError: (error) => toast.fail(errorMessage(error, "Không lưu được ghi chú")),
  });

  const close = () => {
    if (!save.isPending) onClose();
  };

  return (
    <Dialog
      open
      title="Sửa ghi chú"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>Huỷ</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || draft === note}>
            {save.isPending ? "Đang lưu…" : "Lưu ghi chú"}
          </Button>
        </>
      }
    >
      <TextArea
        label="Ghi chú khách hàng"
        rows={6}
        maxLength={5000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={save.isPending}
        placeholder="Nhập ghi chú cho hồ sơ khách…"
        hint={`${draft.length}/5.000 ký tự`}
      />
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { TextArea } from "@/components/ui/TextArea";
import { updateCustomerNote, type CustomerDetail } from "@/lib/api/customers";
import { errorMessage, toast } from "@/lib/toast";

/** Ghi chú riêng cho hồ sơ khách, giữ bản đang nhập nếu lưu thất bại. */
export function CustomerNoteCard({ id, note, canEdit }: { id: string; note: string; canEdit: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const value = draft ?? note;
  const save = useMutation({
    mutationFn: () => updateCustomerNote(id, value),
    onSuccess: async (saved) => {
      queryClient.setQueryData<CustomerDetail>(["customer", id], (previous) => previous ? {
        ...previous, customer: { ...previous.customer, note: saved.note },
      } : previous);
      setDraft(null);
      toast.ok("Đã lưu ghi chú");
      await queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
    onError: (error) => toast.fail(errorMessage(error, "Không lưu được ghi chú")),
  });

  return (
    <SectionCard title="Ghi chú" icon={<StickyNote size={17} />} action={canEdit ? (
      <Button disabled={save.isPending || value === note} onClick={() => save.mutate()}>
        {save.isPending ? "Đang lưu…" : "Lưu ghi chú"}
      </Button>
    ) : undefined}>
      <TextArea label="Ghi chú khách hàng" rows={4} maxLength={5000}
        value={value} onChange={(event) => setDraft(event.target.value)}
        readOnly={!canEdit} disabled={save.isPending}
        placeholder={canEdit ? "Nhập ghi chú cho hồ sơ khách…" : "Chưa có ghi chú"}
        hint={canEdit ? `${value.length}/5.000 ký tự` : undefined} />
    </SectionCard>
  );
}

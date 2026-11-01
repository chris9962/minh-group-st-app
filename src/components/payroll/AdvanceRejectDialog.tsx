"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { actOnAdvance } from "@/lib/api/salaryAdvances";
import { formatVnd } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SalaryAdjustments.module.scss";

type Props = {
  request: { id: string; fullName: string; amount: number };
  onDone: () => void;
  onClose: () => void;
};

export function AdvanceRejectDialog({ request, onDone, onClose }: Props) {
  const [reason, setReason] = useState("");

  const reject = useMutation({
    mutationFn: () => actOnAdvance(request.id, { action: "reject", reason: reason.trim() }),
    onSuccess: () => {
      toast.ok(`Đã từ chối tạm ứng của ${request.fullName}`);
      onDone();
      onClose();
    },
    // Máy chủ từ chối thường vì yêu cầu vừa đổi: tải lại danh sách để người dùng thấy trạng thái mới.
    onError: (e) => {
      toast.fail(errorMessage(e, "Không từ chối được."));
      onDone();
    },
  });

  // Đang gửi thì không đóng: đóng lúc này thì lệnh từ chối vẫn đi, người dùng tưởng đã huỷ.
  const requestClose = () => {
    if (!reject.isPending) onClose();
  };

  return createPortal(
    <Dialog
      open
      narrow
      onClose={requestClose}
      title={`Từ chối tạm ứng ${formatVnd(request.amount)} - ${request.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={reject.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="advance-reject-form" variant="danger" disabled={!reason.trim() || reject.isPending}>
            Từ chối
          </Button>
        </>
      }
    >
      <form
        id="advance-reject-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) reject.mutate();
        }}
      >
        <TextArea
          label="Lý do từ chối"
          required
          rows={3}
          maxLength={500}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Dialog>,
    document.body,
  );
}

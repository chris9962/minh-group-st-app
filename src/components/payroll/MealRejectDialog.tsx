"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { actOnMeal } from "@/lib/api/mealAllowances";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SalaryAdjustments.module.scss";

type Props = {
  row: { id: string; fullName: string };
  onDone: () => void;
  onClose: () => void;
};

/** Kế toán không chi ăn ca riêng: ăn ca của người này trả cùng lương tháng. */
export function MealRejectDialog({ row, onDone, onClose }: Props) {
  const [reason, setReason] = useState("");

  const reject = useMutation({
    mutationFn: () => actOnMeal(row.id, { action: "reject", reason: reason.trim() }),
    onSuccess: () => {
      toast.ok(`Đã chuyển ăn ca của ${row.fullName} sang trả cùng lương tháng`);
      onDone();
      onClose();
    },
    onError: (e) => {
      toast.fail(errorMessage(e, "Không cập nhật được."));
      onDone();
    },
  });

  // Đang gửi thì không đóng: đóng lúc này thì lệnh vẫn đi, người dùng tưởng đã huỷ.
  const requestClose = () => {
    if (!reject.isPending) onClose();
  };

  return createPortal(
    <Dialog
      open
      narrow
      onClose={requestClose}
      title={`Không chi riêng - ${row.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={reject.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="meal-reject-form" variant="danger" disabled={!reason.trim() || reject.isPending}>
            Không chi
          </Button>
        </>
      }
    >
      <form
        id="meal-reject-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) reject.mutate();
        }}
      >
        <TextArea
          label="Lý do"
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

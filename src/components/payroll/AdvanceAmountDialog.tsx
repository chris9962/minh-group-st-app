"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { ADVANCE_MAX } from "@/lib/api/salaryAdvances";
import { formatCount, formatVnd } from "@/lib/format";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SalaryAdjustments.module.scss";

type Props = {
  title: string;
  /** 0 = ô trống, dùng khi gửi yêu cầu mới. */
  initial: number;
  submitLabel: string;
  onSubmit: (amount: number) => Promise<unknown>;
  onDone: () => void;
  /** Máy chủ từ chối, thường vì yêu cầu vừa đổi: nơi gọi tải lại dữ liệu. */
  onFail?: () => void;
  onClose: () => void;
};

/** Nhập số tiền tạm ứng: nhân viên gửi hoặc sửa, Trưởng phòng và kế toán sửa. */
export function AdvanceAmountDialog({ title, initial, submitLabel, onSubmit, onDone, onFail, onClose }: Props) {
  const [amount, setAmount] = useState(initial ? String(initial) : "");
  const value = Number(amount);
  const tooMuch = value > ADVANCE_MAX;

  const save = useMutation({
    mutationFn: () => onSubmit(value),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => {
      toast.fail(errorMessage(e, "Không lưu được."));
      onFail?.();
    },
  });

  // Đang gửi thì không đóng: đóng lúc này thì yêu cầu vẫn đi, người dùng tưởng đã huỷ.
  const requestClose = () => {
    if (!save.isPending) onClose();
  };

  return createPortal(
    <Dialog
      open
      narrow
      onClose={requestClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="advance-amount-form" disabled={!value || tooMuch || save.isPending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id="advance-amount-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (value && !tooMuch) save.mutate();
        }}
      >
        <TextField
          label="Số tiền tạm ứng"
          required
          inputMode="numeric"
          autoFocus
          trailing={<span className={styles.unit}>đ</span>}
          hint={`Tối đa ${formatVnd(ADVANCE_MAX)}`}
          error={tooMuch ? `Tối đa ${formatVnd(ADVANCE_MAX)}.` : undefined}
          value={amount ? formatCount(value) : ""}
          onChange={(e) => setAmount(digitsOnly(e.target.value).replace(/^0+/, "").slice(0, 9))}
        />
      </form>
    </Dialog>,
    document.body,
  );
}

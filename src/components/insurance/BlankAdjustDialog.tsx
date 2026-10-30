"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { digitsOnly } from "@/lib/numberField";

type Props = {
  title: string;
  label: string;
  submitLabel: string;
  /** Trần số nhập được; vượt thì báo lỗi và khoá nút. */
  max?: number;
  onSubmit: (quantity: number) => void;
  onClose: () => void;
};

/** Nhập số phôi cộng thêm hoặc trừ ra ở một ô: "Cấp trong tháng" của phòng hoặc "Đã phát" của người. */
export function BlankAdjustDialog({ title, label, submitLabel, max, onSubmit, onClose }: Props) {
  const [value, setValue] = useState("");
  const quantity = Number(value || 0);
  const tooMany = max !== undefined && quantity > max;

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      narrow
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="blank-adjust-form" disabled={quantity === 0 || tooMany}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id="blank-adjust-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (quantity === 0 || tooMany) return;
          onSubmit(quantity);
          onClose();
        }}
        noValidate
      >
        <TextField
          label={label}
          inputMode="numeric"
          autoFocus
          value={value}
          error={tooMany ? `Tối đa ${max} phôi.` : undefined}
          onChange={(e) => setValue(digitsOnly(e.target.value).slice(0, 9))}
        />
      </form>
    </Dialog>
  );
}

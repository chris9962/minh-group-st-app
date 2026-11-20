"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { updateMealDays, type MealRow } from "@/lib/api/mealAllowances";
import { formatPoints } from "@/lib/format";
import { decimalOnly, numberValue } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SalaryAdjustments.module.scss";

type Props = {
  row: Pick<MealRow, "id" | "fullName" | "days" | "appDays" | "maxDays">;
  onDone: () => void;
  onClose: () => void;
};

/** Trưởng phòng hoặc kế toán sửa số ngày ăn ca của một người, bước 0,5, từ 0 tới trần. */
export function MealDaysDialog({ row, onDone, onClose }: Props) {
  const [text, setText] = useState(formatPoints(row.days));
  const value = numberValue(text);
  const error = Number.isNaN(value)
    ? "Nhập số ngày."
    : value > row.maxDays
      ? `Tối đa ${formatPoints(row.maxDays)} ngày.`
      : !Number.isInteger(value * 2)
        ? "Số ngày theo bước 0,5."
        : undefined;

  const save = useMutation({
    mutationFn: () => updateMealDays(row.id, value),
    onSuccess: () => {
      toast.ok(`Đã sửa số ngày ăn ca của ${row.fullName}`);
      onDone();
      onClose();
    },
    // Máy chủ từ chối thường vì dòng vừa đổi: tải lại danh sách để người sửa thấy số mới.
    onError: (e) => {
      toast.fail(errorMessage(e, "Không lưu được."));
      onDone();
    },
  });

  // Đang gửi thì không đóng: đóng lúc này thì lệnh vẫn đi, người dùng tưởng đã huỷ.
  const requestClose = () => {
    if (!save.isPending) onClose();
  };

  return createPortal(
    <Dialog
      open
      narrow
      onClose={requestClose}
      title={`Sửa số ngày ăn ca - ${row.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="meal-days-form" disabled={Boolean(error) || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="meal-days-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!error) save.mutate();
        }}
      >
        <TextField
          label="Số ngày ăn ca"
          required
          inputMode="decimal"
          autoFocus
          trailing={<span className={styles.unit}>ngày</span>}
          hint={`${row.appDays === null ? "App không tính" : `App tính ${formatPoints(row.appDays)} ngày`}. Tối đa ${formatPoints(row.maxDays)} ngày, bước 0,5.`}
          error={text ? error : undefined}
          value={text}
          onChange={(e) => setText(decimalOnly(e.target.value).slice(0, 4))}
        />
      </form>
    </Dialog>,
    document.body,
  );
}

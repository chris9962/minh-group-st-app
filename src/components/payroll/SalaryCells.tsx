"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatVnd } from "@/lib/format";
import styles from "./SalaryAdjustments.module.scss";

/** Số tiền trong ô bảng, bấm để mở hộp thoại chi tiết. `label` gồm tên người cho trình đọc màn hình. */
export function SalaryAmountButton({
  amount,
  label,
  onClick,
}: {
  amount: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`${styles.amountButton} tabular-nums`} aria-label={label} onClick={onClick}>
      {formatVnd(amount)}
    </button>
  );
}

/** Ô ứng, thưởng, trừ: tổng bấm để xem từng lần, nút "+" ghi thêm một lần. Không có `onAdd` thì không có nút. */
export function SalaryAdjustmentCell({
  amount,
  label,
  addLabel,
  onOpen,
  onAdd,
}: {
  amount: number;
  label: string;
  addLabel: string;
  onOpen: () => void;
  onAdd?: () => void;
}) {
  return (
    <span className={styles.adjustCell}>
      <SalaryAmountButton amount={amount} label={label} onClick={onOpen} />
      {onAdd && (
        <Button variant="secondary" icon tooltip={addLabel} aria-label={addLabel} onClick={onAdd}>
          <Plus size={16} aria-hidden />
        </Button>
      )}
    </span>
  );
}

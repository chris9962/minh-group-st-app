"use client";

import { useState } from "react";
import { ReceiptText } from "lucide-react";
import type { PersonDetail } from "@/lib/api/person";
import { formatVnd } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import styles from "./SalaryBreakdownButton.module.css";

type Props = {
  amount: number;
  breakdown: PersonDetail["salaryBreakdown"];
};

/** Mở phép tính lương đang chạy; chỉ đọc, không thay đổi dữ liệu hay chốt lương. */
export function SalaryBreakdownButton({ amount, breakdown }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ReceiptText size={15} aria-hidden />
        Diễn giải
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Diễn giải lương"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Đóng
          </Button>
        }
      >
        {breakdown.items.length > 0 ? (
          <div className={styles.list}>
            {breakdown.items.map((item, index) => (
              <div className={styles.item} key={`${item.label}-${index}`}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.formula}</span>
                </div>
                <span className="tabular-nums">{formatVnd(item.amount)}</span>
              </div>
            ))}
            <div className={styles.total}>
              <strong>Tổng lương đang tính</strong>
              <strong className="tabular-nums">{formatVnd(amount)}</strong>
            </div>
            <p className={styles.note}>
              Lương này chưa gồm chỉ tiêu HKD, CASA và tài khoản định hướng.
            </p>
          </div>
        ) : (
          <p className={styles.empty}>Chức vụ hoặc phòng này chưa có công thức lương CĐS.</p>
        )}
      </Dialog>
    </>
  );
}

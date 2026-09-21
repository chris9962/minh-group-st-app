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

const monthText = (month: string) => {
  const [y, m] = month.split("-");
  return `tháng ${Number(m)}/${y}`;
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
        title={`Diễn giải lương ${monthText(breakdown.month)}`}
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Đóng
          </Button>
        }
      >
        {breakdown.items.length > 0 ? (
          <>
            <dl className={styles.facts}>
              {breakdown.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd className="tabular-nums">{fact.value}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.list}>
              {breakdown.items.map((item, index) => (
                <div className={styles.item} key={`${item.label}-${index}`}>
                  <strong>{item.label}</strong>
                  <span className={styles.formula}>{item.formula}</span>
                  <span className={`${styles.amount} tabular-nums`}>{formatVnd(item.amount)}</span>
                </div>
              ))}
              <div className={styles.total}>
                <strong>Tổng tạm tính</strong>
                <strong className="tabular-nums">{formatVnd(amount)}</strong>
              </div>
            </div>
            <p className={styles.note}>
              Chưa gồm chỉ tiêu HKD, CASA và tài khoản định hướng.
              <br />
              Kế toán chốt số cuối vào ngày 15 tháng sau.
            </p>
          </>
        ) : (
          <p className={styles.empty}>Chức vụ hoặc phòng này chưa có công thức lương CĐS.</p>
        )}
      </Dialog>
    </>
  );
}

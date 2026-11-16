"use client";

import { useState } from "react";
import type { SalaryBreakdown } from "@/lib/api/person";
import { SalaryAmount } from "./SalaryAmount";
import { SalaryBreakdownButton } from "./SalaryBreakdownButton";
import { SalaryVisibilityButton } from "./SalaryVisibilityButton";
import styles from "./SalaryFact.module.css";

type Props = {
  amount: number;
  breakdown: SalaryBreakdown;
};

/** Ô "Lương" trong khối điểm: số che sẵn, nút hiện/ẩn kế bên, nút diễn giải ở dòng dưới. */
export function SalaryFact({ amount, breakdown }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={styles.fact}>
      <span className={styles.value}>
        <SalaryAmount amount={amount} visible={visible} />
        <SalaryVisibilityButton visible={visible} onToggle={() => setVisible((v) => !v)} />
      </span>
      <SalaryBreakdownButton amount={amount} breakdown={breakdown} />
    </div>
  );
}

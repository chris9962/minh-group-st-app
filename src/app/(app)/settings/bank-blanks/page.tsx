"use client";

import { useState } from "react";
import { BankBlankAllocationSection } from "@/components/banking/BankBlankAllocationSection";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import { can } from "@/lib/permissions";
import type { User } from "@/lib/types";
import styles from "./page.module.scss";

const canOpen = (user: User | null) => can(user, "banking", "allocate-blanks");

/**
 * Văn phòng cấp phiếu thông tin ngân hàng cho phòng theo tháng (chốt 2026-10-31).
 * Phần Trưởng phòng, Phó phòng chia cho nhân viên nằm ở `/banking/blanks`.
 */
export default function BankBlanksPage() {
  const [month, setMonth] = useState(thisMonth);

  return (
    <RequirePermission allow={canOpen}>
      <TopBar title="Cấp phiếu thông tin ngân hàng" keepTitleOnMobile>
        <MonthPicker value={month} onChange={setMonth} monthsAhead={1} />
      </TopBar>
      <main className={styles.body}>
        <BankBlankAllocationSection month={month} />
      </main>
    </RequirePermission>
  );
}

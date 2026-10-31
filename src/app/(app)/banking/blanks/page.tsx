"use client";

import { useState } from "react";
import { BankBlankSplitSection } from "@/components/banking/BankBlankSplitSection";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BackLink } from "@/components/ui/BackLink";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import { can } from "@/lib/permissions";
import type { User } from "@/lib/types";
import styles from "./page.module.scss";

const canOpen = (user: User | null) => can(user, "banking", "split-blanks");

/** Trưởng phòng, Phó phòng chia phiếu thông tin ngân hàng cho nhân viên theo tháng (chốt 2026-10-31). */
export default function BankBlankSplitPage() {
  const [month, setMonth] = useState(thisMonth);

  return (
    <RequirePermission allow={canOpen}>
      <TopBar title="Phát phiếu thông tin ngân hàng" keepTitleOnMobile>
        <MonthPicker value={month} onChange={setMonth} monthsAhead={1} />
      </TopBar>
      <main className={styles.body}>
        <BackLink href="/banking">Ngân hàng</BackLink>
        <BankBlankSplitSection month={month} />
      </main>
    </RequirePermission>
  );
}

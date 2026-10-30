"use client";

import { useState } from "react";
import { BlankSplitSection } from "@/components/insurance/BlankSplitSection";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BackLink } from "@/components/ui/BackLink";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import { can } from "@/lib/permissions";
import type { User } from "@/lib/types";
import styles from "./page.module.scss";

const canOpen = (user: User | null) => can(user, "insurance", "split-blanks");

/** Trưởng phòng chia phôi bảo hiểm cho nhân viên theo tháng (chốt 2026-10-30). */
export default function InsuranceBlankSplitPage() {
  const [month, setMonth] = useState(thisMonth);

  return (
    <RequirePermission allow={canOpen}>
      <TopBar title="Phát phôi bảo hiểm" keepTitleOnMobile>
        <MonthPicker value={month} onChange={setMonth} monthsAhead={1} />
      </TopBar>
      <main className={styles.body}>
        <BackLink href="/insurance">Bảo hiểm</BackLink>
        <BlankSplitSection month={month} />
      </main>
    </RequirePermission>
  );
}

"use client";

import { useState } from "react";
import { BlankAllocationSection } from "@/components/insurance/BlankAllocationSection";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import { can } from "@/lib/permissions";
import type { User } from "@/lib/types";
import styles from "./page.module.scss";

const canOpen = (user: User | null) => can(user, "insurance", "allocate-blanks");

/**
 * Văn phòng cấp phôi bảo hiểm cho phòng theo tháng (chốt 2026-10-29).
 * Phần Trưởng phòng chia cho nhân viên nằm ở `/insurance/blanks` (chốt 2026-10-30).
 */
export default function InsuranceBlanksPage() {
  const [month, setMonth] = useState(thisMonth);

  return (
    <RequirePermission allow={canOpen}>
      <TopBar title="Cấp phôi bảo hiểm" keepTitleOnMobile>
        <MonthPicker value={month} onChange={setMonth} monthsAhead={1} />
      </TopBar>
      <main className={styles.body}>
        <BlankAllocationSection month={month} />
      </main>
    </RequirePermission>
  );
}

"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { QuotaMonthSection } from "@/components/settings/QuotaMonthSection";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import styles from "./page.module.scss";

/** P-85 · Chỉ tiêu tháng theo QĐ 145. */
export default function QuotaMonthPage() {
  const [month, setMonth] = useState(thisMonth);
  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Chỉ tiêu tháng" keepTitleOnMobile>
        <MonthPicker value={month} onChange={setMonth} />
      </TopBar>
      <main className={styles.body}>
        <QuotaMonthSection month={month} />
      </main>
    </RequirePermission>
  );
}

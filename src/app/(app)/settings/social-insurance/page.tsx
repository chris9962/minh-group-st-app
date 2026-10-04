"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { SocialInsuranceSettingsSection } from "@/components/settings/SocialInsuranceSettingsSection";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import styles from "./page.module.scss";

/** P-86 · Cấu hình BHYT/BHXH theo tháng: % hoa hồng và mức điểm KPI An Sinh. */
export default function SocialInsuranceSettingsPage() {
  const [month, setMonth] = useState(thisMonth);
  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="BHYT/BHXH" keepTitleOnMobile>
        <MonthPicker value={month} onChange={setMonth} monthsAhead={1} />
      </TopBar>
      <main className={styles.body}>
        <SocialInsuranceSettingsSection month={month} />
      </main>
    </RequirePermission>
  );
}

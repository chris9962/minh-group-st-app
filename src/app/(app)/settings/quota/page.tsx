"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { QuotaMonthSection } from "@/components/settings/QuotaMonthSection";
import styles from "./page.module.scss";

/** P-85 · Chỉ tiêu tháng theo QĐ 145. */
export default function QuotaMonthPage() {
  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Chỉ tiêu tháng" keepTitleOnMobile />
      <main className={styles.body}>
        <QuotaMonthSection />
      </main>
    </RequirePermission>
  );
}

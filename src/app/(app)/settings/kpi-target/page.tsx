"use client";

import { TopBar } from "@/components/layout/TopBar";
import { KpiTargetSection } from "@/components/settings/KpiTargetSection";
import styles from "./page.module.scss";

/** P-83 · Chỉ tiêu KPI theo tháng. */
export default function KpiTargetPage() {
  return (
    <>
      <TopBar title="Chỉ tiêu KPI" />
      <main className={styles.body}>
        <KpiTargetSection />
      </main>
    </>
  );
}

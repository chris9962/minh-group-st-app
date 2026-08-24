"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { ReferralCodesSection } from "@/components/settings/ReferralCodesSection";
import styles from "./page.module.scss";

/** P-61 · Kho mã giới thiệu. */
export default function ReferralCodesPage() {
  return (
    <RequirePermission module="system" action="manage-referral-codes">
      <TopBar title="Danh sách mã giới thiệu" keepTitleOnMobile />
      <main className={styles.body}>
        <ReferralCodesSection />
      </main>
    </RequirePermission>
  );
}

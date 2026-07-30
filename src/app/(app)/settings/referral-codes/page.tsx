"use client";

import { TopBar } from "@/components/layout/TopBar";
import { ReferralCodesSection } from "@/components/settings/ReferralCodesSection";
import styles from "./page.module.scss";

/** P-61 · Kho mã giới thiệu. */
export default function ReferralCodesPage() {
  return (
    <>
      <TopBar title="Danh sách mã giới thiệu" />
      <main className={styles.body}>
        <ReferralCodesSection />
      </main>
    </>
  );
}

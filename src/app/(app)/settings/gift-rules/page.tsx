"use client";

import { TopBar } from "@/components/layout/TopBar";
import { GiftRulesSection } from "@/components/settings/GiftRulesSection";
import styles from "./page.module.scss";

/** P-81 · Quy tắc quà. */
export default function GiftRulesPage() {
  return (
    <>
      <TopBar title="Quy tắc quà" />
      <main className={styles.body}>
        <GiftRulesSection />
      </main>
    </>
  );
}

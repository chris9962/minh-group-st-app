"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BankCatalogSection } from "@/components/settings/BankCatalogSection";
import styles from "./page.module.scss";

/** P-60 · Kho ngân hàng. */
export default function BanksPage() {
  return (
    <RequirePermission module="banking" action="manage-bank-catalog">
      <TopBar title="Danh sách ngân hàng" />
      <main className={styles.body}>
        <BankCatalogSection />
      </main>
    </RequirePermission>
  );
}

"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { GiftCatalogSection } from "@/components/settings/GiftCatalogSection";
import styles from "./page.module.scss";

/** P-82 · Danh mục quà & gói bảo hiểm. */
export default function GiftCatalogPage() {
  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Danh mục quà & gói bảo hiểm" keepTitleOnMobile />
      <main className={styles.body}>
        <GiftCatalogSection />
      </main>
    </RequirePermission>
  );
}

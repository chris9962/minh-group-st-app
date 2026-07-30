"use client";

import { TopBar } from "@/components/layout/TopBar";
import { GiftCatalogSection } from "@/components/settings/GiftCatalogSection";
import styles from "./page.module.scss";

/** P-82 · Danh mục quà & gói bảo hiểm. */
export default function GiftCatalogPage() {
  return (
    <>
      <TopBar title="Danh mục quà & gói bảo hiểm" />
      <main className={styles.body}>
        <GiftCatalogSection />
      </main>
    </>
  );
}

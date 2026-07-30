"use client";

import { TopBar } from "@/components/layout/TopBar";
import { WardCatalogSection } from "@/components/settings/WardCatalogSection";
import styles from "./page.module.scss";

/** P-71 · Danh mục xã / ấp. */
export default function WardsPage() {
  return (
    <>
      <TopBar title="Danh mục xã / ấp" />
      <main className={styles.body}>
        <WardCatalogSection />
      </main>
    </>
  );
}

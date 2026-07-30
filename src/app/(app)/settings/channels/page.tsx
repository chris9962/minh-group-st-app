"use client";

import { TopBar } from "@/components/layout/TopBar";
import { ChannelCatalogSection } from "@/components/settings/ChannelCatalogSection";
import styles from "./page.module.scss";

/** P-70 · Danh mục kênh. */
export default function ChannelsPage() {
  return (
    <>
      <TopBar title="Danh mục kênh" />
      <main className={styles.body}>
        <ChannelCatalogSection />
      </main>
    </>
  );
}

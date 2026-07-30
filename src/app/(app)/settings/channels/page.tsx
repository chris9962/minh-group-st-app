"use client";

import { TopBar } from "@/components/layout/TopBar";
import { ChannelCatalogSection } from "@/components/settings/ChannelCatalogSection";
import { WardCatalogSection } from "@/components/settings/WardCatalogSection";
import styles from "./page.module.scss";

/**
 * P-70 · Danh mục kênh + P-71 · Danh mục xã/ấp (gộp một trang) — xã/ấp chỉ
 * dùng để phục vụ kênh Ấp/Định danh nên đi chung, không cần trang riêng.
 */
export default function ChannelsPage() {
  return (
    <>
      <TopBar title="Danh mục kênh" />
      <main className={styles.body}>
        <ChannelCatalogSection />
        <WardCatalogSection />
      </main>
    </>
  );
}

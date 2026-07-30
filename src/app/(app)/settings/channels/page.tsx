"use client";

import { TopBar } from "@/components/layout/TopBar";
import { ChannelCatalogSection } from "@/components/settings/ChannelCatalogSection";
import { HospitalCatalogSection } from "@/components/settings/HospitalCatalogSection";
import { WardCatalogSection } from "@/components/settings/WardCatalogSection";
import styles from "./page.module.scss";

/**
 * P-70 · Danh mục kênh + P-71 · Danh mục xã/ấp + P-2.5 · Danh mục bệnh viện
 * (gộp một trang) — xã/ấp và bệnh viện chỉ dùng để phục vụ kênh Ấp/Định danh
 * và kênh Bệnh viện, không cần trang riêng.
 */
export default function ChannelsPage() {
  return (
    <>
      <TopBar title="Danh mục kênh" />
      <main className={styles.body}>
        <ChannelCatalogSection />
        <WardCatalogSection />
        <HospitalCatalogSection />
      </main>
    </>
  );
}

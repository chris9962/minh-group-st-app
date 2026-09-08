"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { ChannelCatalogSection } from "@/components/settings/ChannelCatalogSection";
import { HospitalCatalogSection } from "@/components/settings/HospitalCatalogSection";
import styles from "./page.module.scss";

/**
 * P-70 · Danh mục kênh + P-2.5 · Danh mục bệnh viện (gộp một trang) — bệnh
 * viện chỉ dùng để phục vụ kênh Bệnh viện, không cần trang riêng.
 *
 * P-71 (xã/ấp) từng nằm đây, nay có trang riêng `/settings/wards` (chốt
 * 2026-09-07) vì có quyền riêng và dài hơn hẳn hai khối còn lại.
 */
export default function ChannelsPage() {
  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Danh mục kênh" keepTitleOnMobile />
      <main className={styles.body}>
        <ChannelCatalogSection />
        <HospitalCatalogSection />
      </main>
    </RequirePermission>
  );
}

"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { ServiceTypeSection } from "@/components/settings/ServiceTypeSection";
import styles from "./page.module.scss";

/** P-84 · Danh mục loại dịch vụ + hệ số điểm. */
export default function ServiceTypesPage() {
  return (
    <RequirePermission module="services" action="configure-catalog">
      <TopBar title="Loại dịch vụ" keepTitleOnMobile />
      <main className={styles.body}>
        <ServiceTypeSection />
      </main>
    </RequirePermission>
  );
}

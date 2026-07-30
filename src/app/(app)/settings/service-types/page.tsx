"use client";

import { TopBar } from "@/components/layout/TopBar";
import { ServiceTypeSection } from "@/components/settings/ServiceTypeSection";
import styles from "./page.module.scss";

/** P-84 · Danh mục loại dịch vụ + hệ số điểm. */
export default function ServiceTypesPage() {
  return (
    <>
      <TopBar title="Loại dịch vụ" />
      <main className={styles.body}>
        <ServiceTypeSection />
      </main>
    </>
  );
}

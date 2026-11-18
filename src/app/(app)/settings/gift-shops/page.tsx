"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { GiftShopSection } from "@/components/settings/GiftShopSection";
import styles from "./page.module.scss";

/** Shop mua quà ShopeePay (chủ dự án chốt 2026-11-18). Sản phẩm của từng shop nằm ở trang chi tiết shop. */
export default function GiftShopsPage() {
  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Shop mua quà ShopeePay" keepTitleOnMobile />
      <main className={styles.body}>
        <GiftShopSection />
      </main>
    </RequirePermission>
  );
}

"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { WardCatalogSection } from "@/components/settings/WardCatalogSection";
import { canConfigureWards } from "@/lib/permissions";
import styles from "./page.module.scss";

/**
 * P-71 · Danh mục tỉnh / xã / ấp — trang riêng (chốt 2026-09-07), tách khỏi
 * Danh mục kênh. Có quyền riêng `configure-wards` nên phải có cửa riêng: người
 * chỉ cầm quyền đó không mở được trang kênh, mà trang kênh cũng không có lý do
 * gánh thêm một danh mục dài gấp mấy lần nội dung chính của nó.
 */
export default function WardsPage() {
  return (
    <RequirePermission allow={canConfigureWards}>
      <TopBar title="Danh mục xã / ấp" keepTitleOnMobile />
      <main className={styles.body}>
        <WardCatalogSection />
      </main>
    </RequirePermission>
  );
}

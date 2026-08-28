"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { ServiceTypeSection } from "@/components/settings/ServiceTypeSection";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import styles from "./page.module.scss";

/** P-84 · Danh mục loại dịch vụ + hệ số điểm. */
export default function ServiceTypesPage() {
  const [creating, setCreating] = useState(false);

  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Loại dịch vụ" keepTitleOnMobile>
        {/* Chữ ẩn đi trên màn hẹp, `aria-label` giữ nguyên nghĩa cho trình đọc
            màn hình — cùng cách làm với P-60 và P-61. */}
        <Button aria-label="Thêm loại dịch vụ" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden />
          <span className={buttonStyles.label}>Thêm loại dịch vụ</span>
        </Button>
      </TopBar>
      <main className={styles.body}>
        <ServiceTypeSection creating={creating} onCreatingChange={setCreating} />
      </main>
    </RequirePermission>
  );
}

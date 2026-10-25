"use client";

import { useState } from "react";
import { GiftStockSection } from "@/components/giftStock/GiftStockSection";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import styles from "./page.module.scss";

/** P-87 · Kho quà: nhập quà và tồn kho theo tháng. */
export default function GiftStockPage() {
  const [month, setMonth] = useState(thisMonth);
  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Kho quà" keepTitleOnMobile>
        <MonthPicker value={month} onChange={setMonth} />
      </TopBar>
      <main className={styles.body}>
        <GiftStockSection month={month} />
      </main>
    </RequirePermission>
  );
}

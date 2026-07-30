"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { GiftCatalogSection } from "@/components/settings/GiftCatalogSection";
import { GiftRulesSection } from "@/components/settings/GiftRulesSection";
import { KpiTargetSection } from "@/components/settings/KpiTargetSection";
import { ServiceTypeSection } from "@/components/settings/ServiceTypeSection";
import { SegmentedTabs, type TabOption } from "@/components/ui/SegmentedTabs";
import {
  fetchGiftItems,
  fetchGiftRules,
  fetchInsurancePackages,
  fetchServiceTypes,
} from "@/lib/api/settings";
import styles from "./page.module.scss";

type TabKey = "gift-rules" | "gift-catalog" | "kpi-target" | "service-types";

/** P-81…P-84 · Cấu hình — gộp bốn màn của CEO vào một trang, chuyển bằng tab. */
export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>("gift-rules");

  // Đếm cho nhãn tab đọc trước khi bấm vào — chỉ cần số dòng, không cần tải
  // lại toàn bộ dữ liệu của mọi mục cùng lúc thì cứ để React Query tự cache.
  const { data: rules } = useQuery({ queryKey: ["gift-rules"], queryFn: fetchGiftRules });
  const { data: giftItems } = useQuery({ queryKey: ["gift-items"], queryFn: fetchGiftItems });
  const { data: packages } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });
  const { data: serviceTypes } = useQuery({
    queryKey: ["service-types"],
    queryFn: fetchServiceTypes,
  });

  const tabs: TabOption[] = [
    { value: "gift-rules", label: "Quy tắc quà", count: rules?.length ?? 0 },
    {
      value: "gift-catalog",
      label: "Danh mục quà & gói BH",
      count: (giftItems?.length ?? 0) + (packages?.length ?? 0),
    },
    { value: "kpi-target", label: "Chỉ tiêu KPI", count: 1 },
    { value: "service-types", label: "Loại dịch vụ", count: serviceTypes?.length ?? 0 },
  ];

  return (
    <>
      <TopBar title="Cấu hình" />

      <main className={styles.body}>
        <SegmentedTabs
          label="Mục cấu hình"
          options={tabs}
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
        />

        {tab === "gift-rules" && <GiftRulesSection />}
        {tab === "gift-catalog" && <GiftCatalogSection />}
        {tab === "kpi-target" && <KpiTargetSection />}
        {tab === "service-types" && <ServiceTypeSection />}
      </main>
    </>
  );
}

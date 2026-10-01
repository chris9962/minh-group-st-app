"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { ServiceTypeSection } from "@/components/settings/ServiceTypeSection";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import { fetchServiceTypeMonth, SERVICE_WEIGHTS_FROM } from "@/lib/api/settings";
import { useCreateIntent } from "@/lib/useCreateIntent";
import styles from "./page.module.scss";

/** P-84 · Danh mục loại dịch vụ + hệ số điểm theo tháng. */
export default function ServiceTypesPage() {
  const [creating, setCreating] = useCreateIntent();
  const [month, setMonth] = useState(() =>
    thisMonth() < SERVICE_WEIGHTS_FROM ? SERVICE_WEIGHTS_FROM : thisMonth(),
  );
  // Cùng khoá với `ServiceTypeSection`, React Query chỉ gọi một lần.
  const { data } = useQuery({
    queryKey: ["service-types", month],
    queryFn: () => fetchServiceTypeMonth(month),
  });
  // Chưa tải xong thì coi như đã khoá: nút Thêm không bấm được trước khi biết tháng đã chốt hay chưa.
  const locked = data?.locked ?? true;
  const changeMonth = (next: string) => {
    setCreating(false);
    setMonth(next);
  };

  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title="Loại dịch vụ" keepTitleOnMobile>
        <MonthPicker
          value={month}
          onChange={changeMonth}
          monthsAhead={1}
          minMonth={SERVICE_WEIGHTS_FROM}
        />
        {/* Chữ ẩn đi trên màn hẹp, `aria-label` giữ nguyên nghĩa cho trình đọc
            màn hình — cùng cách làm với P-60 và P-61. */}
        <Button
          aria-label="Thêm loại dịch vụ"
          className={buttonStyles.hideOnMobile}
          disabled={locked}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} aria-hidden />
          <span className={buttonStyles.label}>Thêm loại dịch vụ</span>
        </Button>
      </TopBar>
      <main className={styles.body}>
        <ServiceTypeSection
          month={month}
          creating={creating && !locked}
          onCreatingChange={setCreating}
        />
      </main>
    </RequirePermission>
  );
}

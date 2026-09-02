"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { RuleSimulator, type RuleView } from "@/components/settings/RuleSimulator";
import { SectionTabs } from "@/components/ui/SectionTabs";
import styles from "./page.module.scss";

/**
 * Quy tắc quà và quy tắc điểm — chỉ XEM THỬ, không sửa được.
 *
 * Quyết định 03/08 chuyển quy tắc từ bảng cấu hình sang module code theo kỳ
 * (`src/rules/YYYY-MM.ts`): thể lệ đổi cả HÌNH DẠNG luật theo tháng, nhét vào
 * bảng là dựng ngôn ngữ lập trình trong DB mà tháng sau vẫn thiếu mệnh đề. Đổi
 * lại: đổi thể lệ phải qua dev và deploy.
 *
 * Muốn ĐỌC luật của kỳ thì đọc `mgst-the-le/YYYY-MM.md` — bản nguyên văn. Màn
 * này để thử: khai một tình huống, xem máy trả ra gì.
 *
 * HAI TAB, MỘT ô nhập. `RuleSimulator` giữ nguyên trạng thái khi đổi tab, nên
 * người dùng khai khách một lần rồi lật qua lại xem quà với điểm. Tách thành
 * hai component là mỗi lần đổi tab phải khai lại từ đầu.
 *
 * Tab đang mở nằm trên URL (`?tab=points`), cùng cách với màn Ngân hàng.
 */
const TAB_OPTIONS = [
  { value: "gift", label: "Quy tắc quà" },
  { value: "points", label: "Quy tắc điểm" },
];

export default function GiftRulesPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<RuleView>(() =>
    searchParams.get("tab") === "points" ? "points" : "gift",
  );

  /**
   * `replaceState` chứ không phải `push`: đổi tab không phải một bước điều
   * hướng, nhồi nó vào lịch sử thì nút Quay lại phải bấm nhiều lần mới ra khỏi
   * màn. Đi thẳng qua `history` chứ không qua router Next — đổi tab không cần
   * dựng lại trang, mà `router.replace` thì có, và dựng lại là mất ô nhập.
   */
  const openTab = (next: RuleView) => {
    setTab(next);
    window.history.replaceState(
      null,
      "",
      next === "points" ? "/settings/gift-rules?tab=points" : "/settings/gift-rules",
    );
  };

  return (
    <RequirePermission module="system" action="configure-gift-rules">
      <TopBar title="Quy tắc quà & điểm" keepTitleOnMobile />
      <main className={styles.body}>
        <SectionTabs
          label="Khu vực"
          value={tab}
          onChange={(v) => openTab(v as RuleView)}
          options={TAB_OPTIONS}
        />
        <RuleSimulator view={tab} />
      </main>
    </RequirePermission>
  );
}

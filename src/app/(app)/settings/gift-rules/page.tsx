"use client";

import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { RuleSimulator } from "@/components/settings/RuleSimulator";
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
 * MỘT khối kết quả, không còn tab (chốt 2026-09-03). Quà và điểm cùng một ô
 * nhập, cùng một lượt gọi máy chủ và cùng một kết quả trả về, nên tab chỉ giấu
 * đi nửa số liệu đã tải: người dùng phải lật qua lại để đọc trọn một tình huống.
 */
export default function GiftRulesPage() {
  return (
    <RequirePermission module="system" action="configure-gift-rules">
      <TopBar title="Quy tắc quà & điểm" keepTitleOnMobile />
      <main className={styles.body}>
        <RuleSimulator />
      </main>
    </RequirePermission>
  );
}

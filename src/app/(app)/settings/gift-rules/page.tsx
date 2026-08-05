"use client";

import { TopBar } from "@/components/layout/TopBar";
import { GiftSimulator } from "@/components/settings/GiftSimulator";
import styles from "./page.module.scss";

/**
 * Quy tắc quà — chỉ XEM THỬ, không sửa được.
 *
 * Quyết định 03/08 chuyển quy tắc quà từ bảng cấu hình sang module code theo kỳ
 * (`src/rules/YYYY-MM.ts`): thể lệ đổi cả HÌNH DẠNG luật theo tháng, nhét vào
 * bảng là dựng ngôn ngữ lập trình trong DB mà tháng sau vẫn thiếu mệnh đề. Đổi
 * lại: đổi thể lệ phải qua dev và deploy.
 *
 * Muốn ĐỌC luật của kỳ thì đọc `mgst-the-le/YYYY-MM.md` — bản nguyên văn. Màn
 * này để thử: nhập một tình huống, xem máy trả ra rổ quà nào.
 */
export default function GiftRulesPage() {
  return (
    <>
      <TopBar title="Quy tắc quà" />
      <main className={styles.body}>
        <GiftSimulator />
      </main>
    </>
  );
}

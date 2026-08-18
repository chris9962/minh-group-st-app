"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BankCatalogSection } from "@/components/settings/BankCatalogSection";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import styles from "./page.module.scss";

/**
 * P-60 · Kho ngân hàng.
 *
 * Nút thêm nằm ở THANH TIÊU ĐỀ TRANG, cùng chỗ với "Thêm khách hàng" (P-40) và
 * "Thêm nhân viên" (P-51): người dùng đi qua lại giữa mấy màn này cả ngày, để
 * nút mỗi màn một chỗ là mỗi lần lại phải đi tìm. Trước đó nó nằm dưới bảng, mà
 * bảng cắt 15 dòng một trang nên trên điện thoại phải cuộn hết bảng mới thấy.
 *
 * Vì vậy trang giữ trạng thái mở hộp thoại, `BankCatalogSection` chỉ nhận vào.
 */
export default function BanksPage() {
  const [creating, setCreating] = useState(false);

  return (
    <RequirePermission module="banking" action="manage-bank-catalog">
      <TopBar title="Danh sách ngân hàng" keepTitleOnMobile>
        {/* Chữ ẩn đi trên màn hẹp, `aria-label` giữ nguyên nghĩa cho trình đọc
            màn hình — cùng cách làm với hai màn kia. */}
        <Button aria-label="Thêm ngân hàng" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden />
          <span className={buttonStyles.label}>Thêm ngân hàng</span>
        </Button>
      </TopBar>
      <main className={styles.body}>
        <BankCatalogSection creating={creating} onCreatingChange={setCreating} />
      </main>
    </RequirePermission>
  );
}

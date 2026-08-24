"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BankCatalogSection } from "@/components/settings/BankCatalogSection";
import { ReferralCodesSection } from "@/components/settings/ReferralCodesSection";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * P-60 + P-61 · Ngân hàng và kho mã giới thiệu, MỘT trang hai tab.
 *
 * Gộp từ hai màn rời (chốt 2026-08-24). Một quyền `system:manage-bank` gác cả
 * hai, nên hai mục sidebar là hai đường vào cùng một thứ — và người dùng phải
 * nhớ kho mã nằm ở mục nào.
 *
 * Tab là state trong trang, không đổi đường dẫn, cùng cách màn Xuất dữ liệu
 * (P-73) làm với bốn báo cáo của nó.
 *
 * Nút thêm nằm ở THANH TIÊU ĐỀ TRANG, cùng chỗ với "Thêm khách hàng" (P-40) và
 * "Thêm nhân viên" (P-51): người dùng đi qua lại giữa mấy màn này cả ngày, để
 * nút mỗi màn một chỗ là mỗi lần lại phải đi tìm. Trước đó nó nằm dưới bảng, mà
 * bảng cắt 15 dòng một trang nên trên điện thoại phải cuộn hết bảng mới thấy.
 */
type Tab = "banks" | "codes";

const TAB_OPTIONS = [
  { value: "banks", label: "Danh sách ngân hàng" },
  { value: "codes", label: "Kho mã giới thiệu" },
];

export default function BanksPage() {
  const user = useSession((s) => s.user);
  const [tab, setTab] = useState<Tab>("banks");
  const [creatingBank, setCreatingBank] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);

  /**
   * Lập ngân hàng MỚI chỉ dành cho người quản mọi ngân hàng — máy chủ từ chối
   * người ở phạm vi `listed` (route `POST /api/settings/banks`). Ẩn nút cho
   * khớp: bày ra rồi bấm vào nhận 403 là bắt người dùng đoán vì sao.
   *
   * Nút thêm MÃ thì không ẩn: người quản một ngân hàng vẫn lập được mã cho
   * chính ngân hàng đó.
   */
  const canCreateBank = user?.bankScope === "all";

  return (
    <RequirePermission module="system" action="manage-bank">
      <TopBar title="Ngân hàng & mã giới thiệu" keepTitleOnMobile>
        {/* Chữ ẩn đi trên màn hẹp, `aria-label` giữ nguyên nghĩa cho trình đọc
            màn hình — cùng cách làm với hai màn kia. */}
        {tab === "banks"
          ? canCreateBank && (
              <Button aria-label="Thêm ngân hàng" onClick={() => setCreatingBank(true)}>
                <Plus size={16} aria-hidden />
                <span className={buttonStyles.label}>Thêm ngân hàng</span>
              </Button>
            )
          : (
              <Button aria-label="Thêm mã giới thiệu" onClick={() => setCreatingCode(true)}>
                <Plus size={16} aria-hidden />
                <span className={buttonStyles.label}>Thêm mã</span>
              </Button>
            )}
      </TopBar>
      <main className={styles.body}>
        <SectionTabs
          label="Khu vực"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={TAB_OPTIONS}
        />

        {tab === "banks" ? (
          <BankCatalogSection creating={creatingBank} onCreatingChange={setCreatingBank} />
        ) : (
          <ReferralCodesSection creating={creatingCode} onCreatingChange={setCreatingCode} />
        )}
      </main>
    </RequirePermission>
  );
}

"use client";

import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BankCatalogSection } from "@/components/settings/BankCatalogSection";
import { ReferralCodesSection } from "@/components/settings/ReferralCodesSection";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { canCreateBank, canOpenBankAdmin } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * P-60 + P-61 · Ngân hàng và kho mã giới thiệu, MỘT trang hai tab.
 *
 * Gộp từ hai màn rời (chốt 2026-08-24). Một quyền `system:manage-bank` gác cả
 * hai, nên hai mục sidebar là hai đường vào cùng một thứ — và người dùng phải
 * nhớ kho mã nằm ở mục nào.
 *
 * Tab đang mở nằm trên URL (`?tab=codes`). Tải lại trang hay chia sẻ link thì
 * người nhận thấy đúng tab người gửi đang xem — trước đó tab là state trong
 * trang nên mọi lần tải lại đều quay về Danh sách ngân hàng (chốt 2026-09-01).
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
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get("tab") === "codes" ? "codes" : "banks",
  );
  const [creatingBank, setCreatingBank] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);

  /**
   * Lập ngân hàng MỚI chỉ dành cho người quản mọi ngân hàng — máy chủ từ chối
   * người chỉ có `manage-assigned-banks` (route `POST /api/settings/banks`).
   * Ẩn nút cho khớp: bày ra rồi bấm vào nhận 403 là bắt người dùng đoán vì sao.
   *
   * Nút thêm MÃ thì không ẩn: người quản một ngân hàng vẫn lập được mã cho
   * chính ngân hàng đó.
   */
  const canAddBank = canCreateBank(user);

  /**
   * `replaceState` chứ không phải `push`: đổi tab không phải một bước điều
   * hướng, nhồi nó vào lịch sử thì nút Quay lại phải bấm nhiều lần mới ra khỏi
   * màn. Đi thẳng qua `history` chứ không qua router Next — đổi tab không cần
   * dựng lại trang, mà `router.replace` thì có.
   */
  const openTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(
      null,
      "",
      next === "codes" ? "/settings/banks?tab=codes" : "/settings/banks",
    );
  };

  return (
    <RequirePermission allow={canOpenBankAdmin}>
      <TopBar title="Ngân hàng & mã giới thiệu" keepTitleOnMobile>
        {/* Chữ ẩn đi trên màn hẹp, `aria-label` giữ nguyên nghĩa cho trình đọc
            màn hình — cùng cách làm với hai màn kia. */}
        {tab === "banks"
          ? canAddBank && (
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
          onChange={(v) => openTab(v as Tab)}
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

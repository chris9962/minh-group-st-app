"use client";

import { clsx } from "clsx";
import { Menu, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { CreateBankAccountDialog } from "@/components/banking/CreateBankAccountDialog";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { CreateServiceDialog } from "@/components/services/CreateServiceDialog";
import { NavIcon } from "./NavIcon";
import { useUnreadCount } from "./useUnreadCount";
import type { NavIconKey } from "@/lib/nav";
import { can, canOrg } from "@/lib/permissions";
import type { User } from "@/lib/types";
import styles from "./BottomNav.module.scss";

type Entry =
  | { kind: "link"; href: string; label: string; icon: NavIconKey }
  | { kind: "create"; label: string }
  | { kind: "more"; label: string };

/**
 * KHÔNG có `insurance`: đơn bảo hiểm chỉ tạo được qua luồng Tặng quà (chốt
 * 2026-08-25). Đường tạo đơn lẻ đã gỡ khỏi cả thanh này lẫn màn P-30.
 */
type CreateKind = "customer" | "banking" | "services";

const CREATE_OPTIONS: { kind: CreateKind; label: string; icon: NavIconKey; allowed: (u: User) => boolean }[] = [
  { kind: "customer", label: "Tạo khách hàng", icon: "customers", allowed: () => true },
  {
    kind: "banking",
    label: "Mở tài khoản ngân hàng",
    icon: "banking",
    allowed: (u) => can(u, "banking", "create"),
  },
  { kind: "services", label: "Ghi dịch vụ", icon: "services", allowed: (u) => can(u, "services", "create") },
];

/**
 * Thanh điều hướng đáy — chỉ hiện trên điện thoại (CSS ẩn ở desktop). Khác
 * sidebar đầy đủ mọi mục: đây là 5 lối tắt hay dùng nhất theo QUYỀN của người
 * đang đăng nhập (không hard-code theo chức danh — cùng nguyên tắc với
 * `navFor` ở sidebar), cộng nút "Thêm" mở lại sidebar đầy đủ. Không thay thế
 * sidebar, chỉ rút ngắn thao tác lặp lại hằng ngày.
 *
 * Tổng quan LUÔN đứng đầu (còn quyền xem), Thêm LUÔN đứng cuối — Khách hàng
 * đứng ngay sau Tổng quan vì hồ sơ khách không áp trục phạm vi, ai đăng nhập
 * cũng xem được (giống sidebar). Ô thứ ba đổi theo việc có tạo được bản ghi
 * nghiệp vụ hay không: tạo được thì ưu tiên "Tạo mới"; không (GĐ/PGĐ) thì đổi
 * sang Phòng ban.
 */
export function BottomNav({ user, onOpenMenu }: { user: User; onOpenMenu: () => void }) {
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState<CreateKind | null>(null);
  const unread = useUnreadCount();

  const canCreateBusinessRecord =
    can(user, "banking", "create") || can(user, "insurance", "create") || can(user, "services", "create");
  const canSeeOverview =
    can(user, "insurance", "view-summary") ||
    can(user, "banking", "view-summary") ||
    can(user, "services", "view-summary");
  // Cùng luật với sidebar (`navFor`) — lệch nhau thì điện thoại thiếu lối tắt
  // tới đúng màn người dùng thấy trên máy tính.
  const canReadOrg = canOrg(user, "view-detail");

  const thirdEntry: Entry | null = canCreateBusinessRecord
    ? { kind: "create", label: "Tạo mới" }
    : canReadOrg
      ? { kind: "link", href: "/departments", label: "Phòng ban", icon: "org" }
      : null;

  const entries: Entry[] = [
    ...(canSeeOverview ? [{ kind: "link", href: "/", label: "Tổng quan", icon: "overview" } as Entry] : []),
    { kind: "link", href: "/customers", label: "Khách hàng", icon: "customers" },
    ...(thirdEntry ? [thirdEntry] : []),
    /**
     * Ô áp chót là Thông báo, thay chỗ "Nhân sự" / "Cá nhân" trước đây (chốt
     * 2026-09-10). Hai màn kia vẫn mở được từ sidebar qua nút Thêm, còn thông
     * báo là thứ người dùng phải thấy ngay khi có việc mới.
     *
     * Bấm vào MỞ TRANG chứ không mở hộp thả xuống như chuông ở máy tính. Màn
     * điện thoại không đủ chỗ cho một hộp thả xuống đọc được.
     */
    { kind: "link", href: "/notifications", label: "Thông báo", icon: "notifications" },
    { kind: "more", label: "Thêm" },
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const createOptions = CREATE_OPTIONS.filter((o) => o.allowed(user));

  return (
    <>
      <nav className={styles.bar} aria-label="Điều hướng nhanh">
        {entries.map((entry) => {
          if (entry.kind === "link") {
            const active = isActive(entry.href);
            const badge = entry.href === "/notifications" && unread > 0;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className={clsx(styles.item, active && styles.active)}
                aria-current={active ? "page" : undefined}
                aria-label={badge ? `${entry.label}, ${unread} chưa đọc` : undefined}
              >
                <span className={styles.iconWrap}>
                  <NavIcon name={entry.icon} />
                  {/* Quá 99 thì in "99+": ô đếm chỉ đủ chỗ hai chữ số, và con
                      số chính xác không đổi việc người dùng làm. */}
                  {badge && (
                    <span className={styles.badge} aria-hidden>
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </span>
                <span>{entry.label}</span>
              </Link>
            );
          }

          if (entry.kind === "create") {
            return (
              <button
                key="create"
                type="button"
                className={[styles.item, styles.createItem].join(" ")}
                onClick={() => setPickerOpen(true)}
              >
                <span className={styles.createIcon}>
                  <Plus size={20} strokeWidth={2} aria-hidden />
                </span>
                <span>{entry.label}</span>
              </button>
            );
          }

          return (
            <button key="more" type="button" className={styles.item} onClick={onOpenMenu}>
              <Menu size={18} strokeWidth={1.8} aria-hidden />
              <span>{entry.label}</span>
            </button>
          );
        })}
      </nav>

      {pickerOpen && (
        <Dialog open onClose={() => setPickerOpen(false)} title="Tạo mới">
          <ul className={styles.pickerList}>
            {createOptions.map((o) => (
              <li key={o.kind}>
                <button
                  type="button"
                  className={styles.pickerRow}
                  onClick={() => {
                    setPickerOpen(false);
                    setCreating(o.kind);
                  }}
                >
                  <NavIcon name={o.icon} />
                  <span>{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {creating === "customer" && (
        <CustomerFormDialog open onClose={() => setCreating(null)} />
      )}
      {creating === "banking" && (
        <CreateBankAccountDialog open onClose={() => setCreating(null)} />
      )}
      {creating === "services" && (
        <CreateServiceDialog open onClose={() => setCreating(null)} />
      )}
    </>
  );
}

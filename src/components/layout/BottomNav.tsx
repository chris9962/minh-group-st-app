"use client";

import { clsx } from "clsx";
import { Menu, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { NavIcon } from "./NavIcon";
import { useUnreadCount } from "./useUnreadCount";
import type { JumpTarget, NavIconKey } from "@/lib/nav";
import { jumpCreateActions } from "@/lib/nav";
import { can, canOrg } from "@/lib/permissions";
import type { User } from "@/lib/types";
import styles from "./BottomNav.module.scss";

type Entry =
  | { kind: "link"; href: string; label: string; icon: NavIconKey }
  | { kind: "create"; label: string }
  | { kind: "more"; label: string };

/**
 * Thanh điều hướng đáy — chỉ hiện trên điện thoại (CSS ẩn ở desktop). Khác
 * sidebar đầy đủ mọi mục: đây là 5 lối tắt hay dùng nhất theo QUYỀN của người
 * đang đăng nhập (không hard-code theo chức danh — cùng nguyên tắc với
 * `navFor` ở sidebar), cộng nút "Thêm" mở lại sidebar đầy đủ. Không thay thế
 * sidebar, chỉ rút ngắn thao tác lặp lại hằng ngày.
 *
 * Tổng quan LUÔN đứng đầu (còn quyền xem), Thêm LUÔN đứng cuối — Khách hàng
 * đứng ngay sau Tổng quan vì hồ sơ khách không áp trục phạm vi, ai đăng nhập
 * cũng xem được (giống sidebar). Ô thứ ba là "Tạo mới" khi còn việc tạo được;
 * không thì đổi sang Phòng ban (GĐ/PGĐ chỉ xem).
 *
 * Danh sách việc tạo lấy từ `jumpCreateActions` — cùng nguồn với ô tìm, không
 * bịa lối tắt. Đơn bảo hiểm của đội KD đi qua Tặng quà; mục "Lập đơn" chỉ hiện
 * cho Giám đốc (chốt 2026-09-10).
 */
export function BottomNav({ user, onOpenMenu }: { user: User; onOpenMenu: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const unread = useUnreadCount();
  const createOptions = jumpCreateActions(user);

  const canSeeOverview =
    can(user, "insurance", "view-summary") ||
    can(user, "banking", "view-summary") ||
    can(user, "services", "view-summary");
  const canReadOrg = canOrg(user, "view-detail");

  const thirdEntry: Entry | null =
    createOptions.length > 0
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

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title="Tạo mới" placement="sheet">
        <CreatePicker
          options={createOptions}
          onPick={(href) => {
            setPickerOpen(false);
            router.push(href);
          }}
        />
      </Dialog>
    </>
  );
}

/** Danh mục / thông báo chung — ít bấm hơn việc hàng ngày, tách lưới riêng. */
function isCatalogCreate(href: string): boolean {
  return href.startsWith("/settings/") || href.startsWith("/notifications");
}

function CreatePicker({
  options,
  onPick,
}: {
  options: JumpTarget[];
  onPick: (href: string) => void;
}) {
  const daily = options.filter((o) => !isCatalogCreate(o.href));
  const catalog = options.filter((o) => isCatalogCreate(o.href));
  const split = daily.length > 0 && catalog.length > 0;

  return (
    <div className={styles.picker}>
      {daily.length > 0 && (
        <section className={styles.pickerGroup} aria-label={split ? "Nghiệp vụ" : undefined}>
          {split && <h3 className={styles.pickerGroupTitle}>Nghiệp vụ</h3>}
          <CreatePickerGrid options={daily} onPick={onPick} />
        </section>
      )}
      {catalog.length > 0 && (
        <section className={styles.pickerGroup} aria-label={split ? "Danh mục" : undefined}>
          {split && <h3 className={styles.pickerGroupTitle}>Danh mục</h3>}
          <CreatePickerGrid options={catalog} onPick={onPick} />
        </section>
      )}
    </div>
  );
}

function CreatePickerGrid({
  options,
  onPick,
}: {
  options: JumpTarget[];
  onPick: (href: string) => void;
}) {
  return (
    <ul className={styles.pickerGrid}>
      {options.map((o) => (
        <li key={o.href}>
          <button type="button" className={styles.pickerCard} onClick={() => onPick(o.href)}>
            <span className={styles.pickerIcon}>
              <NavIcon name={o.icon} size={20} />
            </span>
            <span className={styles.pickerLabel}>{o.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

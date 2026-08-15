"use client";

import { clsx } from "clsx";
import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { AccountMenu } from "./AccountMenu";
import { NavIcon } from "./NavIcon";
import { isNavGroup, navFor, type NavGroup } from "@/lib/nav";
import type { User } from "@/lib/types";
import styles from "./Sidebar.module.scss";

const isChildActive = (pathname: string, group: NavGroup): boolean =>
  group.children.some((c) => pathname.startsWith(c.href));

/** Nhóm mở rộng — tự mở sẵn nếu trang đang xem là một mục con của nó. */
function SidebarGroup({
  group,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(() => isChildActive(pathname, group));

  return (
    <li>
      <button
        type="button"
        className={styles.item}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <NavIcon name={group.icon} />
        {group.label}
        <ChevronDown
          size={15}
          aria-hidden
          className={clsx(styles.chevron, open && styles.chevronOpen)}
        />
      </button>

      {open && (
        <ul className={styles.subList}>
          {group.children.map((child) => {
            const active = pathname.startsWith(child.href);
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  className={clsx(styles.subItem, active && styles.active)}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {child.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

type Props = {
  user: User;
  /** Có mở trên điện thoại không — không ảnh hưởng gì ở desktop (luôn hiện sẵn). */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

/**
 * Thanh điều hướng trái. Dùng chung cho mọi vai trò — danh sách mục do quyền
 * quyết định, xem src/lib/nav.ts.
 *
 * Trên điện thoại đây là một hộp thoại trượt ra từ mép trái (xem
 * `.module.scss` — CSS tự chuyển sang `position: fixed` dưới `bp-mobile`),
 * ẩn theo mặc định, mở qua nút hamburger ở `AppShell`. Đóng lại khi: bấm ra
 * ngoài (`onMobileClose` qua backdrop), bấm Esc, hoặc điều hướng sang trang
 * khác — cả ba đều là đồng bộ với thứ NGOÀI React (bàn phím, DOM cuộn), nên
 * hợp lệ để dùng effect, không phải suy ra lúc render.
 */
export function Sidebar({ user, mobileOpen = false, onMobileClose }: Props) {
  const pathname = usePathname();
  const entries = navFor(user);

  useEffect(() => {
    if (!mobileOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {mobileOpen && (
        <div className={styles.backdrop} onClick={onMobileClose} aria-hidden="true" />
      )}

      <nav
        className={clsx(styles.sidebar, mobileOpen && styles.sidebarOpen)}
        aria-label="Điều hướng chính"
      >
        <div className={styles.head}>
          <Logo size={32} />
          <span className={styles.identity}>
            <strong>MGST</strong>
            <span>Nền tảng nội bộ</span>
          </span>
          <button
            type="button"
            className={styles.mobileClose}
            onClick={onMobileClose}
            aria-label="Đóng menu điều hướng"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <ul className={styles.list}>
          {entries.map((entry) => {
            if (isNavGroup(entry)) {
              return (
                <SidebarGroup
                  key={entry.label}
                  group={entry}
                  pathname={pathname}
                  onNavigate={() => onMobileClose?.()}
                />
              );
            }

            const active =
              entry.href === "/" ? pathname === "/" : pathname.startsWith(entry.href);
            return (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className={clsx(styles.item, active && styles.active)}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onMobileClose?.()}
                >
                  <NavIcon name={entry.icon} />
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className={styles.foot}>
          <AccountMenu user={user} />
        </div>
      </nav>
    </>
  );
}

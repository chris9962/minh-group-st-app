"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { AccountMenu } from "./AccountMenu";
import { NavIcon } from "./NavIcon";
import { isNavGroup, navFor, type NavGroup } from "@/lib/nav";
import type { User } from "@/lib/types";
import styles from "./Sidebar.module.scss";

const isChildActive = (pathname: string, group: NavGroup): boolean =>
  group.children.some((c) => pathname.startsWith(c.href));

/** Nhóm mở rộng — tự mở sẵn nếu trang đang xem là một mục con của nó. */
function SidebarGroup({ group, pathname }: { group: NavGroup; pathname: string }) {
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
          className={[styles.chevron, open && styles.chevronOpen].filter(Boolean).join(" ")}
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
                  className={[styles.subItem, active && styles.active]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={active ? "page" : undefined}
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

/**
 * Thanh điều hướng trái. Dùng chung cho mọi vai trò — danh sách mục do quyền
 * quyết định, xem src/lib/nav.ts.
 */
export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();
  const entries = navFor(user);

  return (
    <nav className={styles.sidebar} aria-label="Điều hướng chính">
      <div className={styles.head}>
        <Logo size={32} />
        <span className={styles.identity}>
          <strong>MGST</strong>
          <span>Nền tảng nội bộ</span>
        </span>
      </div>

      <ul className={styles.list}>
        {entries.map((entry) => {
          if (isNavGroup(entry)) {
            return <SidebarGroup key={entry.label} group={entry} pathname={pathname} />;
          }

          const active =
            entry.href === "/" ? pathname === "/" : pathname.startsWith(entry.href);
          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className={[styles.item, active && styles.active]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={active ? "page" : undefined}
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
  );
}

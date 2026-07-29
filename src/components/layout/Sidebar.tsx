"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { navFor } from "@/lib/nav";
import type { User } from "@/lib/types";
import styles from "./Sidebar.module.css";

/**
 * Thanh điều hướng trái. Dùng chung cho mọi vai trò — danh sách mục do quyền
 * quyết định, xem src/lib/nav.ts.
 */
export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();
  const items = navFor(user);

  return (
    <nav className={styles.sidebar} aria-label="Điều hướng chính">
      <div className={styles.head}>
        <Logo size={32} />
        <span className={styles.identity}>
          <strong>MGST</strong>
          <span>{user.title}</span>
        </span>
      </div>

      <ul className={styles.list}>
        {items.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={[styles.item, active && styles.active]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

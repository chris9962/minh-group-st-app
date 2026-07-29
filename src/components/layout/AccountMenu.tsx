"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/store/session";
import type { User } from "@/lib/types";
import styles from "./AccountMenu.module.css";

/** Chữ tắt: chữ đầu của từ đầu và từ cuối — "Nguyễn Thị Bích Trâm" → "NT". */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function AccountMenu({ user }: { user: User }) {
  const router = useRouter();
  const logout = useSession((s) => s.logout);

  return (
    <Popover.Root>
      <Popover.Trigger className={styles.trigger} aria-label="Tài khoản của tôi">
        <span className={styles.avatar} aria-hidden>
          {initials(user.fullName)}
        </span>
        <span className={styles.identity}>
          <strong>{user.fullName}</strong>
          <span>{user.title}</span>
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className={styles.panel}
          side="top"
          align="start"
          sideOffset={8}
        >
          <Popover.Close asChild>
            <Link href="/profile" className={styles.item}>
              Thông tin cá nhân
            </Link>
          </Popover.Close>

          <div className={styles.divider} />

          <Popover.Close asChild>
            <button
              type="button"
              className={`${styles.item} ${styles.danger}`}
              onClick={() => {
                logout();
                router.replace("/login");
              }}
            >
              Đăng xuất
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

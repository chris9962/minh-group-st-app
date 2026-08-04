"use client";

import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout as logoutRequest } from "@/lib/api/auth";
import { useSession } from "@/store/session";
import { useTheme } from "@/store/theme";
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
  const queryClient = useQueryClient();
  const logout = useSession((s) => s.logout);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);

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

          {/* Cố ý KHÔNG đóng menu sau khi đổi: xem thử rồi đổi lại ngay được. */}
          <button type="button" className={styles.item} onClick={toggleTheme}>
            {theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
            <span className={styles.hint} aria-hidden>
              {theme === "dark" ? "☀" : "☾"}
            </span>
          </button>

          <div className={styles.divider} />

          <Popover.Close asChild>
            <button
              type="button"
              className={`${styles.item} ${styles.danger}`}
              onClick={() => {
                // Dọn phía máy TRƯỚC, gọi máy chủ sau và không chờ. Mạng treo
                // (captive portal, backend chết) thì fetch không resolve cũng
                // không reject, `await` sẽ đứng im mãi và người dùng bỏ đi khi
                // vẫn còn đăng nhập — đúng cái rủi ro của máy dùng chung.
                logout();
                queryClient.clear();
                void logoutRequest().catch(() => {});
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

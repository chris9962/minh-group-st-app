"use client";

import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { logout as logoutRequest } from "@/lib/api/auth";
import { useSession } from "@/store/session";
import { nameInitials } from "@/lib/format";
import type { User } from "@/lib/types";
import { AppearanceDialog } from "./AppearanceDialog";
import styles from "./AccountMenu.module.css";

export function AccountMenu({ user }: { user: User }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const logout = useSession((s) => s.logout);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  return (
    <>
      <Popover.Root>
        <Popover.Trigger
          className={styles.trigger}
          aria-label="Tài khoản của tôi"
        >
          <span className={styles.avatar} aria-hidden>
            {nameInitials(user.fullName)}
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

            <Popover.Close asChild>
              <button
                type="button"
                className={styles.item}
                onClick={() => setAppearanceOpen(true)}
              >
                Giao diện
                <Palette size={15} className={styles.hint} aria-hidden />
              </button>
            </Popover.Close>

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

      {/* Nằm ngoài Popover: menu đóng là nội dung của nó bị tháo, hộp thoại đặt
        bên trong sẽ mất theo. */}
      <AppearanceDialog
        open={appearanceOpen}
        onClose={() => setAppearanceOpen(false)}
      />
    </>
  );
}

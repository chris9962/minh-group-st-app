"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import {
  fetchNotifications,
  markNotificationsRead,
  type NotificationRow,
} from "@/lib/api/notifications";
import { formatDateTime } from "@/lib/format";
import { useUnreadCount } from "./useUnreadCount";
import styles from "./NotificationBell.module.css";

/**
 * Chuông trên thanh trên — số chưa đọc, và danh sách rút gọn khi bấm.
 *
 * Hai lượt gọi khác nhau và cố ý tách:
 *
 *   số chưa đọc  hỏi 60 giây một lần trên MỌI màn, chỉ đếm trên chỉ mục một phần
 *   danh sách    chỉ gọi khi người dùng MỞ chuông
 *
 * Gộp làm một là mỗi phút kéo `payload` của 15 dòng về cho một con số.
 */

/** Số dòng trong hộp thả xuống. Xem đủ thì bấm sang trang danh sách. */
const PREVIEW = 8;

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const unread = useUnreadCount();

  /**
   * Chỉ tải khi hộp thả xuống ĐANG MỞ, và bật tắt bằng `enabled`.
   *
   * KHÔNG dùng `enabled: false` rồi gọi `refetchQueries` lúc mở:
   * `refetchQueries` bỏ qua truy vấn đang tắt, nên nó không chạy lần nào và
   * `isPending` đứng mãi ở true — hộp hiện "Đang tải…" không bao giờ hết.
   */
  const { data, isPending } = useQuery({
    queryKey: ["notifications", "bell"],
    queryFn: () => fetchNotifications({ page: 0, sort: "at", dir: "desc" }),
    enabled: open,
  });

  const read = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  function go(row: NotificationRow) {
    if (!row.read) read.mutate(row.id);
    if (row.url) router.push(row.url);
  }

  const rows = data?.rows.slice(0, PREVIEW) ?? [];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.bell}
          aria-label={unread > 0 ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
        >
          <Bell size={18} aria-hidden />
          {/* Quá 99 thì in "99+": ô đếm chỉ đủ chỗ hai chữ số, và con số chính
              xác không đổi việc người dùng làm. */}
          {unread > 0 && (
            <span className={styles.badge} aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className={styles.panel}
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <header className={styles.head}>
            <span className={styles.headTitle}>Thông báo</span>
            <button
              type="button"
              className={styles.readAll}
              onClick={() => read.mutate(undefined)}
              disabled={unread === 0 || read.isPending}
            >
              Đánh dấu đã đọc
            </button>
          </header>

          <div className={styles.list}>
            {isPending && <p className={styles.empty}>Đang tải…</p>}
            {!isPending && rows.length === 0 && (
              <p className={styles.empty}>Chưa có thông báo nào.</p>
            )}
            {rows.map((row) => (
              <Popover.Close asChild key={row.id}>
                <button
                  type="button"
                  className={row.read ? styles.item : `${styles.item} ${styles.unread}`}
                  onClick={() => go(row)}
                >
                  <span className={styles.itemTitle}>{row.title}</span>
                  <span className={styles.itemBody}>{row.body}</span>
                  <span className={styles.itemAt}>{formatDateTime(row.at)}</span>
                </button>
              </Popover.Close>
            ))}
          </div>

          <footer className={styles.foot}>
            <Popover.Close asChild>
              <Link href="/notifications" className={styles.all}>
                Xem tất cả
              </Link>
            </Popover.Close>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

import { and, eq } from "drizzle-orm";
import {
  ALL_ON,
  type NotificationKind,
  type NotificationPrefs,
} from "@/lib/api/notificationPrefs";
import { db } from "./db/client";
import { notificationPrefs } from "./db/schema";

/**
 * Loại thông báo một người muốn nhận.
 *
 * Bảng chỉ lưu dòng cho loại người dùng đã đụng vào. Mọi loại khác coi như BẬT,
 * nên hàm này bắt đầu từ `ALL_ON` rồi mới đè dòng đã lưu lên.
 */
export async function readNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const rows = await db
    .select({ kind: notificationPrefs.kind, enabled: notificationPrefs.enabled })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId));

  const prefs = { ...ALL_ON };
  for (const row of rows) prefs[row.kind as NotificationKind] = row.enabled;
  return prefs;
}

export async function setNotificationPref(
  userId: string,
  kind: NotificationKind,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({ userId, kind, enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [notificationPrefs.userId, notificationPrefs.kind],
      set: { enabled, updatedAt: new Date() },
    });
}

/**
 * Người này còn muốn nhận loại thông báo đó không.
 *
 * Nơi gửi phải hỏi hàm này TRƯỚC khi gọi `sendPushToUser`. Bỏ qua nó là người
 * đã tắt vẫn nhận, và họ không có cách nào tắt được nữa.
 */
export async function wantsNotification(
  userId: string,
  kind: NotificationKind,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: notificationPrefs.enabled })
    .from(notificationPrefs)
    .where(and(eq(notificationPrefs.userId, userId), eq(notificationPrefs.kind, kind)))
    .limit(1);
  return row ? row.enabled : true;
}

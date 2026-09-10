import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { NotificationKind } from "@/lib/api/notificationPrefs";
import type { NotificationPage, NotificationSort } from "@/lib/api/notifications";
import type { Action, ModuleKey } from "@/lib/types";
import { db } from "./db/client";
import { notifications, userPermissions, users } from "./db/schema";
import { wantsNotification } from "./notificationPrefs";
import type { PageArgs } from "./pagination";
import { sendPushToUser } from "./push";

/**
 * C-09 · Gửi thông báo cho một người.
 *
 * ⚠️ MỌI nơi báo tin đi qua đây, đừng gọi thẳng `sendPushToUser`. Hàm này làm
 * đủ ba việc theo ĐÚNG thứ tự, và thứ tự là phần quan trọng nhất:
 *
 *   1. hỏi người đó còn muốn nhận loại này không
 *   2. GHI dòng vào `notifications`
 *   3. đẩy ra điện thoại
 *
 * Ghi trước đẩy sau vì đường đẩy mất được: máy tắt nguồn, chưa bật quyền, iOS
 * tự huỷ đăng ký, người dùng vuốt bỏ trước khi đọc. Ghi trước thì hỏng đường
 * đẩy vẫn còn bản ghi, mở app ra là thấy.
 */

export type NotifyMessage = {
  title: string;
  body: string;
  /** Đường dẫn mở ra khi bấm. Bỏ trống thì dòng chỉ để đọc. */
  url?: string;
};

export async function notify(
  userId: string,
  kind: NotificationKind,
  message: NotifyMessage,
): Promise<boolean> {
  if (!(await wantsNotification(userId, kind))) return false;

  await db.insert(notifications).values({
    userId,
    kind,
    payload: { title: message.title, body: message.body, url: message.url ?? "" },
  });

  /**
   * Đẩy hỏng KHÔNG làm hỏng cả lượt gọi.
   *
   * Dòng đã ghi xong rồi. Ném lỗi ra ngoài là nơi gọi — worker PVI — tưởng cả
   * việc báo tin hỏng, và có thể thử lại rồi ghi dòng thứ hai cho cùng một việc.
   */
  await sendPushToUser(userId, {
    title: message.title,
    body: message.body,
    url: message.url,
    tag: `${kind}-${Date.now()}`,
  }).catch(() => undefined);

  return true;
}

/**
 * Ai nhận một loại thông báo — theo QUYỀN, và đã bỏ người tự tắt loại đó.
 *
 * Kho đơn làm tay là kho CHUNG toàn công ty, không kẹp phạm vi phòng ban (xem
 * ghi chú ở màn chi tiết đơn P-14). Nên danh sách này cũng không kẹp: ai xử lý
 * được đơn thì nhận được tin về đơn.
 *
 * Câu con cộng `coalesce` là cách đọc đúng luật của `notification_prefs`: không
 * có dòng nghĩa là BẬT. Lọc thẳng bằng `enabled = true` sẽ bỏ sót mọi người
 * chưa từng đụng vào công tắc, tức gần như tất cả.
 *
 * ⚠️ `module = '*'` là DẤU SAO, nghĩa là quyền phủ mọi module — xem `scopeFor`
 * ở `lib/permissions.ts`. Lọc đúng một module là bỏ sót người toàn quyền: đo
 * trên database local 2026-09-10, 5 trên 41 người giữ `handle-fallback` ở dấu
 * sao chứ không ở `insurance`.
 */
export async function recipientsFor(
  module: ModuleKey,
  action: Action,
  kind: NotificationKind,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(
      userPermissions,
      and(
        eq(userPermissions.userId, users.id),
        or(eq(userPermissions.module, module), eq(userPermissions.module, "*")),
        eq(userPermissions.action, action),
      ),
    )
    .where(
      and(
        eq(users.active, true),
        sql`coalesce((
          select p.enabled from notification_prefs p
          where p.user_id = ${users.id} and p.kind = ${kind}
        ), true)`,
      ),
    );

  return rows.map((r) => r.id);
}

/**
 * Ai quản MỘT ngân hàng cụ thể — và đã bỏ người tự tắt loại đó.
 *
 * Hai đường vào, khớp `visibleBankIds` ở `lib/permissions.ts`:
 *
 *   manage-bank            quản MỌI ngân hàng, không cần dòng nào trong bảng giao
 *   manage-assigned-banks  chỉ ngân hàng có trong `user_managed_banks`
 *
 * Viết bằng SQL thô vì đây là phép hợp của hai tập, mà một trong hai còn phụ
 * thuộc bảng giao. Dựng bằng trình xây truy vấn thì dài hơn và khó đọc hơn.
 */
export async function bankManagersFor(
  bankId: string,
  kind: NotificationKind,
): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select distinct u.id
    from users u
    join user_permissions p
      on p.user_id = u.id
     and p.module in ('system', '*')
     and p.action in ('manage-bank', 'manage-assigned-banks')
    left join user_managed_banks m
      on m.user_id = u.id and m.bank_id = ${bankId}
    where u.active
      and (p.action = 'manage-bank' or m.bank_id is not null)
      and coalesce((
        select np.enabled from notification_prefs np
        where np.user_id = u.id and np.kind = ${kind}
      ), true)
  `);

  return rows.rows.map((r) => r.id);
}

/**
 * Gửi cho một danh sách người ĐÃ LỌC sẵn.
 *
 * ⚠️ Hàm này KHÔNG kiểm `notification_prefs`. Nơi gọi phải lọc trước, và
 * `recipientsFor` đã làm việc đó trong cùng một câu truy vấn. Gọi thẳng bằng
 * một danh sách tự dựng là gửi cho cả người đã tắt loại đó.
 *
 * Một lệnh chèn cho mọi người thay vì N lệnh: một đơn làm tay có thể báo cho
 * hàng chục người, và N lệnh chèn rời là N lượt đi lại với database.
 */
export async function notifyUsers(
  userIds: readonly string[],
  kind: NotificationKind,
  message: NotifyMessage,
): Promise<number> {
  if (userIds.length === 0) return 0;

  const payload = { title: message.title, body: message.body, url: message.url ?? "" };
  await db.insert(notifications).values(userIds.map((userId) => ({ userId, kind, payload })));

  // Đẩy hỏng không làm hỏng cả lượt gọi: dòng đã ghi xong, mở app vẫn thấy.
  await Promise.all(
    userIds.map((userId) =>
      sendPushToUser(userId, {
        title: message.title,
        body: message.body,
        url: message.url,
        tag: `${kind}-${Date.now()}`,
      }).catch(() => undefined),
    ),
  );

  return userIds.length;
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

export async function listNotifications(
  userId: string,
  page: PageArgs<NotificationSort>,
): Promise<NotificationPage> {
  const mine = eq(notifications.userId, userId);

  /**
   * Chỉ dòng của CHÍNH người đăng nhập, và điều kiện đó nằm ngay trong câu
   * truy vấn chứ không lọc sau. Bảng này không có phạm vi phòng ban: thông báo
   * là của một người, không của một phòng.
   */
  const [rows, [total], unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        payload: notifications.payload,
        at: sql<string>`to_char(${notifications.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(mine)
      .orderBy(page.dir === "asc" ? notifications.createdAt : desc(notifications.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: count() }).from(notifications).where(mine),
    unreadCount(userId),
  ]);

  return {
    rows: rows.map((row) => {
      const payload = (row.payload ?? {}) as { title?: string; body?: string; url?: string };
      return {
        id: row.id,
        kind: row.kind as NotificationKind,
        title: payload.title ?? "",
        body: payload.body ?? "",
        url: payload.url ?? "",
        at: row.at,
        read: row.readAt !== null,
      };
    }),
    total: total?.value ?? 0,
    unread,
  };
}

/**
 * Đánh dấu đã đọc. Bỏ trống `id` là đánh dấu TẤT CẢ của người đó.
 *
 * `user_id` luôn nằm trong điều kiện, kể cả khi có `id`: biết mã một dòng của
 * người khác thì vẫn không đọc hộ được.
 */
export async function markRead(userId: string, id?: string): Promise<void> {
  const mine = eq(notifications.userId, userId);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        mine,
        isNull(notifications.readAt),
        id ? eq(notifications.id, id) : undefined,
      ),
    );
}

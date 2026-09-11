import { z } from 'zod';
import { NotificationKind } from './notificationPrefs';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * C-09 · Danh sách thông báo trong app.
 *
 * Đây là bản ghi THẬT của một thông báo. Đẩy ra điện thoại chỉ là đường báo
 * nhanh, và nó mất được: máy tắt nguồn, chưa bật quyền, iOS tự huỷ đăng ký, hay
 * người dùng vuốt bỏ trước khi đọc. Nên nơi gửi ghi dòng vào đây TRƯỚC rồi mới
 * đẩy — hỏng đường đẩy thì mở app vẫn thấy.
 */

export const NotificationRow = z.object({
  id: z.string(),
  kind: NotificationKind,
  title: z.string(),
  body: z.string(),
  /** Đường dẫn mở ra khi bấm. Rỗng thì dòng không bấm được. */
  url: z.string(),
  /** ISO 8601, giờ UTC. */
  at: z.string(),
  read: z.boolean(),
});
export type NotificationRow = z.infer<typeof NotificationRow>;

export const NotificationPage = pageOf(NotificationRow).extend({
  /** Số chưa đọc của TOÀN BỘ danh sách, không riêng trang đang xem. */
  unread: z.number(),
});
export type NotificationPage = Page<NotificationRow> & { unread: number };

export const NOTIFICATION_SORT = ['at'] as const;
export type NotificationSort = (typeof NOTIFICATION_SORT)[number];

export async function fetchNotifications(
  query: PageQuery<NotificationSort>,
): Promise<NotificationPage> {
  const res = await fetch(`/api/notifications?${pageParams(query)}`);
  if (!res.ok) throw new Error('Không đọc được danh sách thông báo');
  return NotificationPage.parse(await res.json());
}

/** Chỉ số chưa đọc, cho chuông trên thanh trên. Nhẹ hơn hẳn câu lấy danh sách. */
export async function fetchUnreadCount(): Promise<number> {
  const res = await fetch('/api/notifications/unread');
  if (!res.ok) throw new Error('Không đọc được số thông báo chưa đọc');
  return z.object({ unread: z.number() }).parse(await res.json()).unread;
}

/** Bỏ trống `id` là đánh dấu đã đọc TẤT CẢ. */
export async function markNotificationsRead(id?: string): Promise<void> {
  const res = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id ? { id } : {}),
  });
  if (!res.ok) throw new Error('Không đánh dấu đã đọc được');
}

export const MarkReadBody = z.object({ id: z.string().uuid().optional() });
export type MarkReadBody = z.infer<typeof MarkReadBody>;

/**
 * Thông báo chung gửi cho toàn công ty.
 *
 * Giới hạn độ dài KHÔNG phải chống phá hoại, mà để tin đọc được trên thanh
 * thông báo của điện thoại: iOS và Android đều cắt bớt phần thừa.
 */
export const AnnouncementBody = z.object({
  title: z.string().trim().min(1, 'Nhập tiêu đề').max(80),
  body: z.string().trim().min(1, 'Nhập nội dung').max(300),
  /**
   * Đường dẫn mở ra khi bấm vào thông báo. Bỏ trống thì dòng chỉ để đọc.
   *
   * Phải bắt đầu bằng `/`, và đó là ràng buộc KỸ THUẬT chứ không phải nghi ngờ
   * người gửi: cả hai đường bấm đều mở trong app — `router.push` ở danh sách và
   * `clients.openWindow` ở service worker. Địa chỉ ngoài không mở đúng ở đó.
   */
  url: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || v.startsWith('/'), 'Đường dẫn phải bắt đầu bằng /'),
});
export type AnnouncementBody = z.infer<typeof AnnouncementBody>;

/** Số người đã nhận, để màn gửi báo lại con số thật. */
export const AnnouncementResult = z.object({ sent: z.number().int().nonnegative() });
export type AnnouncementResult = z.infer<typeof AnnouncementResult>;

export async function sendAnnouncement(body: AnnouncementBody): Promise<AnnouncementResult> {
  const res = await fetch('/api/notifications/announce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Không gửi được thông báo chung');
  return AnnouncementResult.parse(await res.json());
}

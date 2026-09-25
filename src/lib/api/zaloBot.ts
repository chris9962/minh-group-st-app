import { z } from 'zod';
import { pageOf, pageParams, type Page, type PageQuery } from '@/lib/api/pagination';

/**
 * Màn Bot Zalo — bot chạy bằng tài khoản Zalo cá nhân qua zca-js, gác bằng
 * `system:view-ops` như màn Vận hành P-99.
 *
 * App không giữ phiên Zalo. Worker `zalo:worker` giữ phiên, app đọc trạng thái
 * worker ghi và đưa tin nhắn vào hàng chờ cho worker gửi.
 */

/** Nhịp tim cũ hơn ngần này giây thì coi như worker không chạy. Worker ghi nhịp tim mỗi 30 giây. */
export const ZALO_WORKER_STALE_SECONDS = 90;
export const ZALO_BODY_MAX = 2000;
export const ZALO_RECENT_OUTBOX = 10;

export const ZaloBotStatus = z.enum(['offline', 'waiting-qr', 'qr-scanned', 'connected', 'error']);
export type ZaloBotStatus = z.infer<typeof ZaloBotStatus>;

export const ZALO_BOT_STATUS_LABEL: Record<ZaloBotStatus, string> = {
  offline: 'Chưa đăng nhập',
  'waiting-qr': 'Chờ quét mã QR',
  'qr-scanned': 'Đã quét, chờ xác nhận trên điện thoại',
  connected: 'Đang kết nối',
  error: 'Mất kết nối',
};

export const ZaloThreadType = z.enum(['group', 'user']);
export type ZaloThreadType = z.infer<typeof ZaloThreadType>;

export const ZALO_THREAD_TYPE_LABEL: Record<ZaloThreadType, string> = {
  group: 'Nhóm',
  user: 'Cá nhân',
};

export const ZaloOutboxStatus = z.enum(['pending', 'sent', 'failed']);
export type ZaloOutboxStatus = z.infer<typeof ZaloOutboxStatus>;

export const ZALO_OUTBOX_STATUS_LABEL: Record<ZaloOutboxStatus, string> = {
  pending: 'Chờ gửi',
  sent: 'Đã gửi',
  failed: 'Gửi lỗi',
};

export const ZaloOutboxRow = z.object({
  id: z.string(),
  threadId: z.string(),
  threadType: ZaloThreadType,
  body: z.string(),
  status: ZaloOutboxStatus,
  error: z.string(),
  createdAt: z.string(),
});
export type ZaloOutboxRow = z.infer<typeof ZaloOutboxRow>;

export const ZaloBotSummary = z.object({
  status: ZaloBotStatus,
  workerAlive: z.boolean(),
  /** Data URL của mã QR. Rỗng khi không chờ quét hoặc worker không chạy. */
  qrImage: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  lastError: z.string(),
  logoutPending: z.boolean(),
  /** ISO datetime của lượt tải danh sách nhóm gần nhất. Rỗng khi chưa tải lần nào. */
  groupsSyncedAt: z.string(),
  groupsSyncPending: z.boolean(),
  recentOutbox: z.array(ZaloOutboxRow),
});
export type ZaloBotSummary = z.infer<typeof ZaloBotSummary>;

export const ZaloGroupRow = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number(),
});
export type ZaloGroupRow = z.infer<typeof ZaloGroupRow>;
export const ZaloGroupPage = pageOf(ZaloGroupRow);

export const ZALO_GROUP_SORTS = ['name', 'memberCount'] as const;
export type ZaloGroupSort = (typeof ZALO_GROUP_SORTS)[number];

export const ZaloGroupOption = z.object({ id: z.string(), name: z.string() });
export type ZaloGroupOption = z.infer<typeof ZaloGroupOption>;

/**
 * Loại thông báo tự động. Điều kiện và nội dung tin viết trong code, ở
 * `src/server/zalo/notifications.ts`. Màn Bot Zalo chỉ chọn loại nào gửi tới nhóm nào.
 */
export const ZaloNotificationKind = z.enum(['insurance-certificate-overdue']);
export type ZaloNotificationKind = z.infer<typeof ZaloNotificationKind>;

/** Đơn chờ giấy chứng nhận quá ngần này phút thì báo vào nhóm Zalo, mỗi đơn một lần. */
export const ZALO_CERT_OVERDUE_MINUTES = 20;

export const ZALO_NOTIFICATION_LABEL: Record<ZaloNotificationKind, string> = {
  'insurance-certificate-overdue': `Đơn bảo hiểm chờ giấy chứng nhận quá ${ZALO_CERT_OVERDUE_MINUTES} phút`,
};

export const ZaloNotificationRoute = z.object({
  kind: ZaloNotificationKind,
  groups: z.array(ZaloGroupOption),
});
export type ZaloNotificationRoute = z.infer<typeof ZaloNotificationRoute>;

export const ZaloNotificationRoutesBody = z.object({
  groupIds: z.array(z.string().regex(/^\d+$/)).max(100),
});
export type ZaloNotificationRoutesBody = z.infer<typeof ZaloNotificationRoutesBody>;

export const ZaloSendBody = z.object({
  threadType: ZaloThreadType,
  threadId: z
    .string()
    .trim()
    .min(1, 'Nhập Thread ID')
    .max(32, 'Thread ID quá dài')
    .regex(/^\d+$/, 'Thread ID chỉ gồm chữ số'),
  body: z
    .string()
    .trim()
    .min(1, 'Nhập nội dung')
    .max(ZALO_BODY_MAX, `Nội dung tối đa ${ZALO_BODY_MAX} ký tự`),
});
export type ZaloSendBody = z.infer<typeof ZaloSendBody>;

export async function fetchZaloBot(): Promise<ZaloBotSummary> {
  const res = await fetch('/api/zalo-bot');
  if (!res.ok) throw new Error('Không đọc được trạng thái bot Zalo');
  return ZaloBotSummary.parse(await res.json());
}

export async function sendZaloMessage(body: ZaloSendBody): Promise<void> {
  const res = await fetch('/api/zalo-bot/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message ?? 'Không đưa được tin nhắn vào hàng chờ');
  }
}

export async function logoutZaloBot(): Promise<void> {
  const res = await fetch('/api/zalo-bot/logout', { method: 'POST' });
  if (!res.ok) throw new Error('Không gửi được yêu cầu đăng xuất');
}

export async function fetchZaloGroups(
  query: PageQuery<ZaloGroupSort>,
  search: string,
): Promise<Page<ZaloGroupRow>> {
  const res = await fetch(`/api/zalo-bot/groups?${pageParams(query, { search })}`);
  if (!res.ok) throw new Error('Không đọc được danh sách nhóm Zalo');
  return ZaloGroupPage.parse(await res.json());
}

export async function fetchZaloGroupOptions(): Promise<ZaloGroupOption[]> {
  const res = await fetch('/api/zalo-bot/groups/options');
  if (!res.ok) throw new Error('Không đọc được danh sách nhóm Zalo');
  return z.array(ZaloGroupOption).parse(await res.json());
}

export async function fetchZaloNotificationRoutes(): Promise<ZaloNotificationRoute[]> {
  const res = await fetch('/api/zalo-bot/notifications');
  if (!res.ok) throw new Error('Không đọc được cấu hình thông báo');
  return z.array(ZaloNotificationRoute).parse(await res.json());
}

export async function saveZaloNotificationRoutes(
  kind: ZaloNotificationKind,
  body: ZaloNotificationRoutesBody,
): Promise<void> {
  const res = await fetch(`/api/zalo-bot/notifications/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message ?? 'Không lưu được cấu hình thông báo');
  }
}

export async function syncZaloGroups(): Promise<void> {
  const res = await fetch('/api/zalo-bot/groups/sync', { method: 'POST' });
  if (!res.ok) throw new Error('Không gửi được yêu cầu tải lại danh sách nhóm');
}

import { z } from 'zod';
import type { Action, ModuleKey } from '../types';

/**
 * C-09 · Loại thông báo người dùng muốn nhận.
 *
 * Danh sách này khớp enum `notification_kind` trong database. Thêm loại mới thì
 * sửa ĐỦ BA chỗ: enum trong migration, enum dưới đây, và bảng nhãn. Thiếu một
 * chỗ thì công tắc hiện ra mà lưu không được, hoặc lưu được mà không ai thấy.
 */
export const NotificationKind = z.enum([
  'order-done',
  'order-manual',
  'code-low',
  'bank-error',
  'bank-pending',
  'bank-approved',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * Loại ĐANG hiện công tắc. Thứ tự trong mảng cũng là thứ tự trên màn hình.
 *
 * Mảng này hẹp hơn enum, và cố ý hẹp hơn: chỉ liệt kê loại ĐÃ có nơi gửi. Hai
 * loại còn thiếu nơi gửi nên tạm gỡ khỏi đây (2026-09-10):
 *
 *   order-done  chưa có ai gọi notify() lúc đơn nhận được giấy chứng nhận
 *   code-low    chưa chốt ngưỡng "sắp hết", chưa chốt kiểm lúc nào
 *
 * Bày công tắc cho loại chưa có nơi gửi là người dùng bật lên rồi chờ mãi không
 * thấy gì, và họ báo hệ thống hỏng. Nối xong nơi gửi thì thêm lại vào đây, không
 * phải sửa enum hay migration.
 */
export const NOTIFICATION_KINDS: NotificationKind[] = [
  'order-manual',
  'bank-error',
  'bank-pending',
  'bank-approved',
];

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  'order-manual': 'Đơn chuyển sang làm tay',
  'order-done': 'Đơn đã có giấy chứng nhận',
  'bank-error': 'Tài khoản của tôi bị đánh lỗi',
  'bank-pending': 'Tài khoản chờ duyệt lại',
  'bank-approved': 'Tài khoản của tôi được duyệt',
  'code-low': 'Kho mã giới thiệu sắp hết',
};

/**
 * Quyền phải có thì công tắc của loại đó mới hiện ra.
 *
 * Có MỘT trong danh sách là đủ. Loại không nằm trong bảng này thì ai cũng thấy.
 *
 * Đây chỉ là lọc cho MẮT NHÌN, không phải phân quyền. Người nhận thật sự do nơi
 * gửi chọn, và nơi đó cũng hỏi lại quyền — xem `recipientsFor` ở máy chủ. Bày ra
 * một công tắc mà bật lên không bao giờ có thông báo nào thì người dùng tưởng
 * hệ thống hỏng.
 */
export const NOTIFICATION_KIND_NEEDS: Partial<
  Record<NotificationKind, { module: ModuleKey; actions: Action[] }>
> = {
  'order-manual': { module: 'insurance', actions: ['handle-fallback'] },
  /** Hai loại của CHỦ tài khoản: ai mở được tài khoản thì mới sở hữu tài khoản. */
  'bank-error': { module: 'banking', actions: ['create'] },
  'bank-approved': { module: 'banking', actions: ['create'] },
  /** Loại của NGƯỜI DUYỆT — hai quyền mở cùng màn quản lý ngân hàng. */
  'bank-pending': { module: 'system', actions: ['manage-bank', 'manage-assigned-banks'] },
  'code-low': { module: 'system', actions: ['manage-bank', 'manage-assigned-banks'] },
};

/** Bật hết. Không có dòng trong database nghĩa là bật, xem `notification_prefs`. */
export const ALL_ON: Record<NotificationKind, boolean> = {
  'order-manual': true,
  'order-done': true,
  'bank-error': true,
  'bank-pending': true,
  'bank-approved': true,
  'code-low': true,
};

export const NotificationPrefs = z.record(NotificationKind, z.boolean());
export type NotificationPrefs = Record<NotificationKind, boolean>;

export const NotificationPrefBody = z.object({
  kind: NotificationKind,
  enabled: z.boolean(),
});
export type NotificationPrefBody = z.infer<typeof NotificationPrefBody>;

export async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  const res = await fetch('/api/notification-prefs');
  if (!res.ok) throw new Error('Không đọc được cài đặt thông báo');
  return { ...ALL_ON, ...NotificationPrefs.parse(await res.json()) };
}

export async function saveNotificationPref(body: NotificationPrefBody): Promise<void> {
  const res = await fetch('/api/notification-prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Không lưu được cài đặt thông báo');
}

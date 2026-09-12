import { z } from 'zod';
import type { NavIconKey } from '../nav';
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
  'announcement',
  'bank-photo-fail',
  'bank-photo-review',
  'bank-deleted',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * Loại ĐANG hiện công tắc. Thứ tự trong mảng cũng là thứ tự trên màn hình.
 *
 * Mảng này hẹp hơn enum, và cố ý hẹp hơn. Ba loại nằm ngoài (2026-09-11):
 *
 *   order-done    chưa có ai gọi notify() lúc đơn nhận được giấy chứng nhận
 *   code-low      chưa chốt ngưỡng "sắp hết", chưa chốt kiểm lúc nào
 *   announcement  KHÔNG cho tắt, xem ngay dưới
 *
 * `announcement` là thông báo chung của công ty, chốt 2026-09-11 là không cho
 * tắt. Người tắt sẽ không biết công ty nghỉ lễ hay đổi lịch. Nơi gửi cũng bỏ
 * qua `notification_prefs`, xem `notifyEveryone`.
 *
 * Bày công tắc cho loại chưa có nơi gửi là người dùng bật lên rồi chờ mãi không
 * thấy gì, và họ báo hệ thống hỏng. Nối xong nơi gửi thì thêm lại vào đây, không
 * phải sửa enum hay migration.
 */
export const NOTIFICATION_KINDS: SwitchableKind[] = [
  'order-manual',
  'bank-error',
  'bank-pending',
  'bank-approved',
  'bank-photo-fail',
  'bank-photo-review',
  'bank-deleted',
];

/**
 * Loại CÓ thể có công tắc.
 *
 * `announcement` đứng ngoài và sẽ đứng ngoài mãi: thông báo chung của công ty
 * không cho tắt, nên nó không có nhãn công tắc, không có ô quyền để lọc, và
 * không bao giờ vào `NOTIFICATION_KINDS`.
 */
export type SwitchableKind = Exclude<NotificationKind, 'announcement'>;

/** Nhãn của CÔNG TẮC. Chỉ dùng ở danh sách công tắc trong trang cá nhân. */
export const NOTIFICATION_KIND_LABEL: Record<SwitchableKind, string> = {
  'order-manual': 'Đơn chuyển sang làm tay',
  'order-done': 'Đơn đã có giấy chứng nhận',
  'bank-error': 'Tài khoản của tôi bị đánh lỗi',
  'bank-pending': 'Tài khoản chờ duyệt lại',
  'bank-approved': 'Tài khoản của tôi được duyệt',
  'bank-photo-fail': 'Ảnh tài khoản ngân hàng của tôi không đạt',
  'bank-photo-review': 'Tài khoản không đạt xác thực ảnh',
  'bank-deleted': 'Tài khoản đang tạo của tôi bị xoá',
  'code-low': 'Kho mã giới thiệu sắp hết',
};

/**
 * Nhóm CÔNG TẮC theo module, để trang cài đặt bày theo từng khối thay vì một
 * danh sách phẳng — người dùng quét nhanh biết loại nào của module nào.
 *
 * Chỉ liệt kê icon nào thật sự đứng trước MỘT loại switchable — `announcement`
 * (icon `org`) không nằm trong `NOTIFICATION_KINDS` nên không cần nhóm.
 */
export const NOTIFICATION_GROUP_LABEL: Partial<Record<NavIconKey, string>> = {
  insurance: 'Bảo hiểm',
  banking: 'Ngân hàng',
};

/**
 * Icon của từng loại, để nhìn một cái là biết tin thuộc module nào.
 *
 * Lấy ĐÚNG icon module ở thanh điều hướng, không vẽ bộ mới: người dùng đã quen
 * cái khiên là Bảo hiểm và cái nhà băng là Ngân hàng, nên dùng lại thì không
 * phải học thêm gì.
 *
 * `code-low` là kho mã giới thiệu. Nó nằm ở màn cấu hình chứ không ở màn Ngân
 * hàng, nhưng người nhận là người quản ngân hàng và mã giới thiệu gắn với ngân
 * hàng, nên xếp cùng nhóm đó.
 */
export const NOTIFICATION_KIND_ICON: Record<NotificationKind, NavIconKey> = {
  'order-manual': 'insurance',
  'order-done': 'insurance',
  'bank-error': 'banking',
  'bank-pending': 'banking',
  'bank-approved': 'banking',
  'bank-photo-fail': 'banking',
  'bank-photo-review': 'banking',
  'bank-deleted': 'banking',
  'code-low': 'banking',
  /** Toà nhà, cùng icon với màn Cơ cấu tổ chức: tin này của cả công ty. */
  announcement: 'org',
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
  'bank-photo-fail': { module: 'banking', actions: ['create'] },
  'bank-deleted': { module: 'banking', actions: ['create'] },
  /** Loại của NGƯỜI DUYỆT — hai quyền mở cùng màn quản lý ngân hàng. */
  'bank-pending': { module: 'system', actions: ['manage-bank', 'manage-assigned-banks'] },
  'bank-photo-review': { module: 'system', actions: ['manage-bank', 'manage-assigned-banks'] },
  'code-low': { module: 'system', actions: ['manage-bank', 'manage-assigned-banks'] },
};

/** Bật hết. Không có dòng trong database nghĩa là bật, xem `notification_prefs`. */
export const ALL_ON: Record<NotificationKind, boolean> = {
  'order-manual': true,
  'order-done': true,
  'bank-error': true,
  'bank-pending': true,
  'bank-approved': true,
  'bank-photo-fail': true,
  'bank-photo-review': true,
  'bank-deleted': true,
  'code-low': true,
  announcement: true,
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

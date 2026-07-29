import type { Permission, RoleKey } from './types';

/**
 * Bộ quyền đặt sẵn theo chức vụ.
 *
 * Ở `lib` chứ không ở `mocks`: quy tắc chặn tự nâng quyền phải đọc được bộ quyền
 * của từng vai để biết vai nào vượt quá quyền người đang thao tác.
 *
 * Vai trò chỉ là TÊN ĐẶT SẴN cho một tập bộ ba, không phải nguồn quyền. Admin
 * vẫn gán tay đè lên được cho từng người.
 */

const p = (
  module: Permission['module'],
  action: Permission['action'],
  scope: Permission['scope'],
): Permission => ({ module, action, scope });

/** Nhân viên kinh doanh — phạm vi hẹp nhất, không hiện thanh chọn phạm vi. */
const staffPermissions: Permission[] = [
  p('insurance', 'view-stats', 'own'),
  p('insurance', 'view-detail', 'own'),
  p('insurance', 'create', 'own'),
  p('insurance', 'update', 'own'),
  p('insurance', 'download', 'own'),
  p('banking', 'view-stats', 'own'),
  p('banking', 'view-detail', 'own'),
  p('banking', 'create', 'own'),
  p('banking', 'grant-gift', 'own'),
  p('services', 'view-detail', 'own'),
  p('services', 'create', 'own'),
];

/**
 * Trưởng phòng và Phó GĐ dùng CÙNG bộ hành động với nhân viên, chỉ khác phạm vi.
 * `create` vẫn là `own` — quản lý xem được đơn của lính nhưng không tạo hộ ai.
 */
const managerPermissions: Permission[] = [
  ...staffPermissions.map((x) =>
    x.action === 'create' ? x : { ...x, scope: 'managed' as const },
  ),
  p('insurance', 'export-excel', 'managed'),
  p('banking', 'export-excel', 'managed'),
];

/**
 * Ban giám đốc có `manage-users` nhưng KHÔNG có `grant-permission`: nhận việc,
 * luân chuyển, bổ nhiệm là quyết định nhân sự chứ không phải việc IT. Gán được
 * vai trò có sẵn, không sửa được vai trò gồm những quyền gì.
 */
export const directorPermissions: Permission[] = [
  p('*', 'view-stats', 'company'),
  p('*', 'view-detail', 'company'),
  p('*', 'download', 'company'),
  p('*', 'export-excel', 'company'),
  p('*', 'configure-catalog', 'company'),
  p('*', 'configure-gift-rules', 'company'),
  p('*', 'grant-gift', 'company'),
  p('system', 'manage-users', 'company'),
];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  director: directorPermissions,
  'deputy-director': managerPermissions,
  head: managerPermissions,
  'deputy-head': managerPermissions,
  staff: staffPermissions,
};

export { managerPermissions, staffPermissions };

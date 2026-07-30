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
 * Ban giám đốc: toàn quyền — theo đúng lối thoát mà spec §3.1 đã tính sẵn
 * ("Nếu sếp vẫn muốn toàn quyền: cứ cấp"). Mọi hành động, phạm vi `company`.
 *
 * CHỈ THIẾU `grant-permission`: đây là hành động DUY NHẤT tự nâng quyền được
 * cho chính mình, spec giữ nó ở 1–2 tài khoản quản trị dù CEO có toàn quyền
 * ở mọi chỗ khác — nới nó ra thì chốt chặn tự nâng quyền ở
 * `assignableRoles` (permissions.ts) mất tác dụng.
 */
export const directorPermissions: Permission[] = [
  p('*', 'view-stats', 'company'),
  p('*', 'view-detail', 'company'),
  p('*', 'create', 'company'),
  p('*', 'update', 'company'),
  p('*', 'cancel', 'company'),
  p('*', 'download', 'company'),
  p('*', 'export-excel', 'company'),
  p('*', 'handle-fallback', 'company'),
  p('*', 'manage-codes', 'company'),
  p('*', 'grant-gift', 'company'),
  p('*', 'configure-catalog', 'company'),
  p('*', 'configure-gift-rules', 'company'),
  p('*', 'manage-users', 'company'),
  p('*', 'manage-org', 'company'),
];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  director: directorPermissions,
  'deputy-director': managerPermissions,
  head: managerPermissions,
  'deputy-head': managerPermissions,
  staff: staffPermissions,
};

export { managerPermissions, staffPermissions };

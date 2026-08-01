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
  /** Hồ sơ khách hàng: xem luôn mở toàn công ty (spec §2.1b), không áp phạm vi
   *  dù người này chỉ có `own` ở mọi module khác. */
  p('customer', 'view-detail', 'company'),
  p('customer', 'create', 'own'),
  p('customer', 'update', 'own'),
  p('insurance', 'view-summary', 'own'),
  p('insurance', 'view-detail', 'own'),
  p('insurance', 'create', 'own'),
  p('insurance', 'update', 'own'),
  p('banking', 'view-summary', 'own'),
  p('banking', 'view-detail', 'own'),
  p('banking', 'create', 'own'),
  /** Xoá tài khoản đang tạo dở (chưa hoàn thành) — nhả lại chỗ mã (spec §4.5). */
  p('banking', 'delete', 'own'),
  p('banking', 'grant-gift', 'own'),
  p('services', 'view-detail', 'own'),
  p('services', 'create', 'own'),
];

/**
 * Trưởng phòng và Phó GĐ dùng CÙNG bộ hành động với nhân viên, chỉ khác phạm vi.
 * `create` vẫn là `own` — quản lý xem được đơn của lính nhưng không tạo hộ ai.
 * `customer:view-detail` không nới vì đã ở mức rộng nhất (`company`) sẵn rồi.
 *
 * Thêm riêng: quản được người — thêm/sửa/khoá nhân viên trong phòng mình phụ
 * trách (`staff`), và xuất Excel ở phạm vi phòng quản.
 */
const managerPermissions: Permission[] = [
  ...staffPermissions.map((x) =>
    x.action === 'create' || (x.module === 'customer' && x.action === 'view-detail')
      ? x
      : { ...x, scope: 'managed' as const },
  ),
  p('insurance', 'export', 'managed'),
  p('banking', 'export', 'managed'),
  p('staff', 'view-summary', 'managed'),
  p('staff', 'view-detail', 'managed'),
  p('staff', 'create', 'managed'),
  p('staff', 'update', 'managed'),
  p('staff', 'delete', 'managed'),
];

/**
 * Ban giám đốc: xem/xuất mọi module + mọi hành động đặc biệt, phạm vi
 * `company` — nhưng KHÔNG `tạo`/`sửa`/`xoá` bản ghi nghiệp vụ (spec §10.3):
 * bẩn số liệu ai-tạo-bao-nhiêu-đơn, bấm nhầm không phục hồi được, và CEO vốn
 * không tự nhập đơn nên quyền đó chỉ nằm không mà không giải quyết gì.
 *
 * CRUD `nhân viên` là ngoại lệ được liệt kê riêng: nhận việc/luân chuyển/khoá
 * tài khoản là quyết định nhân sự, không phải quyết định kinh doanh, nên vẫn
 * cấp cho CEO dù không cấp `tạo/sửa/xoá` cho các module còn lại.
 *
 * CHỈ THIẾU `grant-permission`: đây là hành động DUY NHẤT tự nâng quyền được
 * cho chính mình, spec giữ nó ở 1–2 tài khoản quản trị dù CEO có gần như toàn
 * quyền ở mọi chỗ khác — nới nó ra thì chốt chặn tự nâng quyền ở
 * `assignableRoles` (permissions.ts) mất tác dụng.
 */
export const directorPermissions: Permission[] = [
  p('*', 'view-summary', 'company'),
  p('*', 'view-detail', 'company'),
  p('*', 'export', 'company'),
  p('*', 'handle-fallback', 'company'),
  p('*', 'manage-referral-codes', 'company'),
  p('*', 'manage-bank-catalog', 'company'),
  p('*', 'grant-gift', 'company'),
  p('*', 'configure-catalog', 'company'),
  p('*', 'configure-gift-rules', 'company'),
  p('*', 'manage-org', 'company'),
  p('staff', 'create', 'company'),
  p('staff', 'update', 'company'),
  p('staff', 'delete', 'company'),
];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  director: directorPermissions,
  'deputy-director': managerPermissions,
  head: managerPermissions,
  'deputy-head': managerPermissions,
  staff: staffPermissions,
};

export { managerPermissions, staffPermissions };

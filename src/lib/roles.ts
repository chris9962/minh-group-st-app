import { Action } from './types';
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
 *
 * SỬA DANH MỤC cũng nằm ở đây (CEO chốt 05/08). Trước đây bốn quyền danh mục
 * chỉ có ở Giám đốc nên mọi việc bảo trì đều dồn lên một người. Đây là quyền
 * GHI; quyền ĐỌC danh mục không nằm ở đâu cả — ai đăng nhập cũng đọc được, chặn
 * ở `signedIn` bên `server/auth.ts`.
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
  p('*', 'configure-catalog', 'company'),
  p('*', 'manage-bank-catalog', 'company'),
  p('*', 'manage-referral-codes', 'company'),
];

/**
 * Ban giám đốc: TOÀN QUYỀN, không trừ hành động nào, không trừ module nào,
 * phạm vi `company` (CEO chốt 06/08).
 *
 * Sinh từ `Action.options` chứ không liệt kê tay: thêm một hành động mới vào
 * `lib/types.ts` là CEO có ngay. Liệt kê tay thì hành động mới lặng lẽ thiếu ở
 * vai này, và không có gì báo — đúng cách `access-id-number` từng thiếu, khiến
 * cả CEO cũng chỉ thấy 4 số cuối CCCD.
 *
 * Bản trước cố ý giữ lại ba thứ, nay bỏ hết theo quyết định của CEO:
 *
 * - `sửa`/`xoá` bản ghi nghiệp vụ. Lý do cũ ("sửa đè là viết lại thành tích
 *   người khác") KHÔNG đúng: điểm KPI gom theo `created_by` (`server/people.ts`),
 *   sửa một bản ghi không chuyển công sang người sửa. Sửa vẫn đổi được SỐ ĐIỂM
 *   của người tạo — `app_installed`, `opened_date`, `status`, hệ số loại dịch
 *   vụ đều là trường tính điểm — nhưng đó là rủi ro nghiệp vụ, không phải rủi
 *   ro phân quyền, và mọi lượt ghi đều nằm trong nhật ký truy vết P-93.
 *
 * - `grant-permission`. ⚠️ Đây là hành động DUY NHẤT tự nâng quyền được cho
 *   chính mình. Cấp cho vai này nghĩa là: CEO gán được mọi chức vụ, sửa được cả
 *   tài khoản quản trị (`canActOn`), và chốt chặn ở `assignableRoles` không còn
 *   ràng buộc gì với họ. Đánh đổi đã biết và được chấp nhận — tài khoản CEO từ
 *   nay phải được giữ như tài khoản quản trị.
 */
export const directorPermissions: Permission[] = Action.options.map((action) =>
  p('*', action, 'company'),
);

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  director: directorPermissions,
  'deputy-director': managerPermissions,
  head: managerPermissions,
  'deputy-head': managerPermissions,
  staff: staffPermissions,
};

export { managerPermissions, staffPermissions };

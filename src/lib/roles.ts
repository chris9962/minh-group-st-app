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
  /**
   * Huỷ một đơn nhập nhầm khi nó CHƯA hoàn thành — xoá hẳn, không có trạng thái
   * "đã huỷ" (cùng lối với tài khoản ngân hàng bỏ dở, spec §4.5).
   *
   * Máy chủ chặn hai ca mà quyền này không mở ra được: đơn đã `Hoàn thành` là
   * hợp đồng đã phát hành bên PVI, và đơn quà tặng là vết của một đợt tặng quà.
   */
  p('insurance', 'delete', 'own'),
  /**
   * Xử lý đơn tay — CẤP CHO MỌI NGƯỜI (chốt 06/08), không riêng một đội.
   *
   * Chưa có bot PVI nên MỌI đơn đều phải có người mở web PVI nhập tay; đơn sinh
   * thẳng ở `Chờ làm tay` (xem `NEW_ORDER_STATUS` ở `server/insurance.ts`).
   * Gói quyền này vào một nhóm nhỏ thì cả công ty tạo đơn mà chỉ vài người đẩy
   * được đơn đi, và hàng đợi dồn lại ngay ngày đầu.
   *
   * Phạm vi đi theo đúng luật của module: nhân viên xử lý đơn của chính mình,
   * quản lý xử lý đơn của phòng mình quản. Cần một đội trung tâm cầm đơn của cả
   * công ty thì cấp riêng `toàn công ty` cho họ ở P-92.
   */
  p('insurance', 'handle-fallback', 'own'),
  p('banking', 'view-summary', 'own'),
  p('banking', 'view-detail', 'own'),
  p('banking', 'create', 'own'),
  /**
   * BƯỚC 2 của luồng mở tài khoản (spec §4.2) và mọi thao tác ảnh chứng minh.
   *
   * Thiếu quyền này thì KHÔNG AI hoàn thành nổi một tài khoản nào: bấm "Tiếp
   * tục" xong là kẹt vĩnh viễn ở `creating`, mã giới thiệu bị giữ mà không bao
   * giờ tiêu, và điểm KPI đứng im. Đủ ảnh mới cho Hoàn thành, mà tải ảnh cũng
   * đi qua đúng quyền này.
   */
  p('banking', 'update', 'own'),
  /** Xoá tài khoản đang tạo dở (chưa hoàn thành) — nhả lại chỗ mã (spec §4.5). */
  p('banking', 'delete', 'own'),
  p('banking', 'grant-gift', 'own'),
  p('services', 'view-summary', 'own'),
  p('services', 'view-detail', 'own'),
  p('services', 'create', 'own'),
  /**
   * Dịch vụ không có màn sửa (spec P-31): ghi sai thì xoá rồi ghi lại. Nhưng
   * quyền `update` vẫn cấp để mọi module nghiệp vụ có cùng bộ sáu hành động —
   * ngày P-31 mở đường sửa thì không phải đi vá phân quyền lần nữa, và đó đúng
   * là lần vá mà module ngân hàng vừa phải chịu.
   */
  p('services', 'update', 'own'),
  p('services', 'delete', 'own'),
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
  /**
   * Xuất Excel chỉ từ cấp quản lý trở lên — kéo cả kho về máy khác hẳn xem một
   * bản ghi. Bốn quyền này phải khớp ĐÚNG bốn báo cáo ở màn Xuất dữ liệu; thiếu
   * cái nào thì báo cáo đó hiện ra rồi bấm vào nhận 403 mà không hiểu vì sao.
   */
  p('insurance', 'export', 'managed'),
  p('banking', 'export', 'managed'),
  p('services', 'export', 'managed'),
  p('staff', 'export', 'managed'),
  /**
   * Xuất danh sách khách — Phó GĐ, Trưởng phòng, Phó phòng (chốt 06/08).
   *
   * Phạm vi `company` chứ không phải `managed`, và đó là mô tả THẬT chứ không
   * phải nới tay: hồ sơ khách KHÔNG áp trục phạm vi (spec §2.1b), nên
   * `listCustomersForExport` không đọc phạm vi ở đâu cả — file luôn gồm mọi
   * khách khớp bộ lọc. Ghi `managed` ở đây là nói dối cho êm tai: nhìn bảng
   * quyền tưởng hẹp, mà file xuất ra vẫn là cả kho.
   *
   * Bản xuất KHÔNG chứa CCCD: `CustomerRow` không có trường đó. CCCD đi đường
   * riêng, gác bằng `customer:access-id-number`.
   */
  p('customer', 'export', 'company'),
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

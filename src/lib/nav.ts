import { can } from './permissions';
import type { User } from './types';

/**
 * Menu sinh ra từ QUYỀN ĐƯỢC CẤP, không từ chức danh.
 *
 * Nhân viên được cấp thêm quyền thì sidebar tự mọc thêm mục — không có bảng
 * ánh xạ "vai trò → menu" nào ở đây, vì như vậy sẽ lệch với quyền thật.
 *
 * Ẩn mục chỉ là trang trí. Máy chủ vẫn phải chặn ở tầng dữ liệu.
 */

/** Tên icon của lucide-react. Sidebar tra sang component ở `NAV_ICONS`. */
export type NavIconKey =
  | 'overview'
  | 'insurance'
  | 'banking'
  | 'services'
  | 'customers'
  | 'people'
  | 'target'
  | 'settings'
  | 'exports'
  | 'permissions'
  | 'org'
  | 'audit';

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconKey;
  /** Mã màn hình trong mgst-feature-list.md — để đối chiếu khi rà soát. */
  screen: string;
};

/** Mục con trong một nhóm mở rộng — không có icon riêng, đi theo icon của nhóm. */
export type NavChild = {
  href: string;
  label: string;
  screen: string;
};

/** Nhóm mở rộng trong sidebar — ví dụ "Cấu hình" gồm nhiều màn nhỏ. */
export type NavGroup = {
  label: string;
  icon: NavIconKey;
  children: NavChild[];
};

export type NavEntry = NavItem | NavGroup;

export const isNavGroup = (entry: NavEntry): entry is NavGroup => 'children' in entry;

export function navFor(user: User | null): NavEntry[] {
  if (!user) return [];

  const items: NavEntry[] = [];

  if (
    can(user, 'insurance', 'view-stats') ||
    can(user, 'banking', 'view-stats') ||
    can(user, 'services', 'view-stats')
  ) {
    items.push({ href: '/', label: 'Tổng quan', icon: 'overview', screen: 'P-80' });
  }

  if (can(user, 'insurance', 'view-detail')) {
    items.push({ href: '/insurance', label: 'Bảo hiểm', icon: 'insurance', screen: 'P-13' });
  }

  if (can(user, 'banking', 'view-detail')) {
    items.push({ href: '/banking', label: 'Ngân hàng', icon: 'banking', screen: 'P-21' });
  }

  if (can(user, 'services', 'view-detail')) {
    items.push({ href: '/services', label: 'Dịch vụ', icon: 'services', screen: 'P-31' });
  }

  // Hồ sơ khách hàng không áp trục phạm vi — ai đăng nhập được cũng thấy.
  items.push({ href: '/customers', label: 'Khách hàng', icon: 'customers', screen: 'P-40' });

  // Vào được màn Nhân sự bằng HAI đường: quản phòng thì xem điểm của lính, còn
  // `manage-users` thì vào để tạo/sửa người — quản trị hệ thống không quản
  // phòng nào nhưng vẫn phải mở được danh sách này.
  items.push(
    user.manageScope === 'none' && !can(user, 'system', 'manage-users')
      ? { href: '/my-target', label: 'Chỉ tiêu của tôi', icon: 'target', screen: 'P-50' }
      : { href: '/people', label: 'Nhân sự & KPI', icon: 'people', screen: 'P-51' },
  );

  // "Cấu hình" gộp mọi màn thiết lập vào một nhóm, nhưng mục con nào hiện ra
  // vẫn theo đúng quyền riêng của nó — Kinh doanh tổng hợp thấy ngân hàng/mã
  // giới thiệu, còn quy tắc quà/danh mục/chỉ tiêu/loại dịch vụ vẫn của CEO
  // (spec §3.1: "CEO KHÔNG có... kho mã giới thiệu").
  const settingsChildren: NavChild[] = [];

  if (can(user, 'system', 'configure-gift-rules')) {
    settingsChildren.push({ href: '/settings/gift-rules', label: 'Quy tắc quà', screen: 'P-81' });
  }
  if (can(user, 'insurance', 'configure-catalog')) {
    settingsChildren.push({
      href: '/settings/gift-catalog',
      label: 'Danh mục quà & gói BH',
      screen: 'P-82',
    });
  }
  if (can(user, 'system', 'configure-catalog')) {
    settingsChildren.push({ href: '/settings/kpi-target', label: 'Chỉ tiêu KPI', screen: 'P-83' });
  }
  if (can(user, 'services', 'configure-catalog')) {
    settingsChildren.push({
      href: '/settings/service-types',
      label: 'Loại dịch vụ',
      screen: 'P-84',
    });
  }
  if (can(user, 'banking', 'manage-codes') || can(user, 'banking', 'configure-catalog')) {
    settingsChildren.push({ href: '/settings/banks', label: 'Danh sách ngân hàng', screen: 'P-60' });
  }
  if (can(user, 'banking', 'manage-codes')) {
    settingsChildren.push({
      href: '/settings/referral-codes',
      label: 'Danh sách mã giới thiệu',
      screen: 'P-61',
    });
  }
  if (can(user, 'system', 'configure-catalog')) {
    settingsChildren.push({ href: '/settings/channels', label: 'Danh mục kênh', screen: 'P-70' });
    settingsChildren.push({
      href: '/settings/wards',
      label: 'Danh mục xã / ấp',
      screen: 'P-71',
    });
  }

  if (settingsChildren.length > 0) {
    items.push({ label: 'Cấu hình', icon: 'settings', children: settingsChildren });
  }

  if (can(user, 'system', 'manage-org')) {
    items.push({ href: '/departments', label: 'Phòng ban', icon: 'org', screen: 'P-91' });
  }

  if (
    can(user, 'insurance', 'export-excel') ||
    can(user, 'banking', 'export-excel') ||
    can(user, 'services', 'export-excel')
  ) {
    items.push({ href: '/exports', label: 'Xuất dữ liệu', icon: 'exports', screen: 'P-73' });
  }

  // Không có mục "tài khoản người dùng" riêng: nhân viên và tài khoản là một
  // thứ nên quản trị tài khoản nằm luôn trong màn Nhân sự ở trên.
  if (can(user, 'system', 'grant-permission')) {
    items.push({ href: '/permissions', label: 'Phân quyền', icon: 'permissions', screen: 'P-92' });
  }

  if (can(user, 'system', 'view-detail')) {
    items.push({ href: '/audit-log', label: 'Nhật ký truy vết', icon: 'audit', screen: 'P-93' });
  }

  return items;
}

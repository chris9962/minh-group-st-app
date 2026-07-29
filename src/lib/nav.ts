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

export type NavItem = {
  href: string;
  label: string;
  /** Mã màn hình trong mgst-feature-list.md — để đối chiếu khi rà soát. */
  screen: string;
};

export function navFor(user: User | null): NavItem[] {
  if (!user) return [];

  const items: NavItem[] = [];

  if (
    can(user, 'insurance', 'view-stats') ||
    can(user, 'banking', 'view-stats') ||
    can(user, 'services', 'view-stats')
  ) {
    items.push({ href: '/', label: 'Tổng quan', screen: 'P-80' });
  }

  if (can(user, 'insurance', 'view-detail')) {
    items.push({ href: '/insurance', label: 'Bảo hiểm', screen: 'P-13' });
  }

  if (can(user, 'banking', 'view-detail')) {
    items.push({ href: '/banking', label: 'Ngân hàng', screen: 'P-21' });
  }

  if (can(user, 'services', 'view-detail')) {
    items.push({ href: '/services', label: 'Dịch vụ', screen: 'P-31' });
  }

  // Hồ sơ khách hàng không áp trục phạm vi — ai đăng nhập được cũng thấy.
  items.push({ href: '/customers', label: 'Khách hàng', screen: 'P-40' });

  // Chỉ người quản phòng mới thấy "Nhân sự & KPI"; còn lại là chỉ tiêu của mình.
  items.push(
    user.manageScope === 'none'
      ? { href: '/my-target', label: 'Chỉ tiêu của tôi', screen: 'P-50' }
      : { href: '/people', label: 'Nhân sự & KPI', screen: 'P-51' },
  );

  if (
    can(user, 'banking', 'manage-codes') ||
    can(user, 'insurance', 'manage-codes')
  ) {
    items.push({ href: '/codes', label: 'Kho mã & ngân hàng', screen: 'P-60' });
  }

  if (
    can(user, 'system', 'configure-catalog') ||
    can(user, 'system', 'configure-gift-rules') ||
    can(user, 'banking', 'configure-catalog')
  ) {
    items.push({ href: '/settings', label: 'Cấu hình', screen: 'P-81' });
  }

  if (
    can(user, 'insurance', 'export-excel') ||
    can(user, 'banking', 'export-excel') ||
    can(user, 'services', 'export-excel')
  ) {
    items.push({ href: '/exports', label: 'Xuất dữ liệu', screen: 'P-73' });
  }

  if (can(user, 'system', 'manage-users')) {
    items.push({ href: '/users', label: 'Tài khoản & phân quyền', screen: 'P-90' });
  }

  if (can(user, 'system', 'view-detail')) {
    items.push({ href: '/audit-log', label: 'Nhật ký truy vết', screen: 'P-93' });
  }

  return items;
}

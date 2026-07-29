import { SCOPES, type Action, type ModuleKey, type Permission, type Scope, type User } from './types';

/**
 * ĐÚNG MỘT hàm kiểm quyền cho toàn hệ thống (quyết định kỹ thuật #9).
 *
 * Danh sách, chi tiết, xuất Excel, API cho app — tất cả đi qua đây.
 * Mỗi màn tự làm một kiểu là sẽ có màn quên lọc, và đó là lỗ rò dữ liệu.
 *
 * Lưu ý: đây là kiểm ở GIAO DIỆN, chỉ để ẩn/hiện. Máy chủ vẫn phải kiểm lại —
 * ẩn nút không phải là phân quyền.
 */

const scopeRank = (s: Scope): number => SCOPES.indexOf(s);

/** Phạm vi rộng nhất mà người này có trên (module, hành động). Không có → null. */
export function scopeFor(
  user: User | null,
  module: ModuleKey,
  action: Action,
): Scope | null {
  if (!user) return null;

  const matched = user.permissions.filter(
    (p: Permission) => (p.module === module || p.module === '*') && p.action === action,
  );
  if (matched.length === 0) return null;

  return matched.reduce((widest, p) =>
    scopeRank(p.scope) > scopeRank(widest.scope) ? p : widest,
  ).scope;
}

/** Có được làm hành động này trên module này không (chưa xét bản ghi cụ thể). */
export function can(user: User | null, module: ModuleKey, action: Action): boolean {
  return scopeFor(user, module, action) !== null;
}

/**
 * Các mức phạm vi hiện trên thanh lọc.
 *
 * Trả về 0 hoặc 1 mức thì KHÔNG hiện thanh — nhân viên kinh doanh nhìn thấy
 * giao diện y như không có tính năng này.
 *
 * `managed` chỉ có nghĩa với người thật sự quản phòng nào đó; giám đốc có
 * `company` nhưng không phụ trách phòng cụ thể nên bỏ mức giữa đi.
 */
export function availableScopes(
  user: User | null,
  module: ModuleKey,
  action: Action = 'view-detail',
): Scope[] {
  const widest = scopeFor(user, module, action);
  if (!user || !widest) return [];

  return SCOPES.slice(0, scopeRank(widest) + 1).filter((s) => {
    // `phòng tôi quản` chỉ có nghĩa với người thật sự phụ trách phòng nào đó.
    if (s === 'managed') return user.manageScope === 'listed';
    // `của tôi` chỉ có nghĩa với người thật sự tạo bản ghi.
    // Giám đốc không tạo đơn nên mức này luôn rỗng — bỏ đi, còn một mức thì
    // thanh chọn phạm vi tự ẩn.
    if (s === 'own') return can(user, module, 'create');
    return true;
  });
}

/**
 * Các phòng người này được xem dữ liệu.
 *
 * `null` nghĩa là KHÔNG giới hạn phòng nào — dùng cho phạm vi toàn công ty.
 * Đừng thay bằng "danh sách tất cả phòng": mở phòng mới là thiếu ngay.
 */
export function visibleDepartmentIds(
  user: User | null,
  scope: Scope,
): string[] | null {
  if (!user) return [];
  if (scope === 'company') return null;
  if (scope === 'managed') return user.managedDepartmentIds;
  return user.departmentId ? [user.departmentId] : [];
}

/**
 * Hồ sơ KHÁCH HÀNG không áp trục phạm vi — mọi nhân viên xem được toàn công ty
 * (spec mục 2.1b). Chỉ BẢN GHI NGHIỆP VỤ mới áp.
 *
 * Bắt buộc phải như vậy: không thì chặn cứng CCCD trùng và ô tìm kiếm đều vô dụng.
 */
export function canViewCustomers(user: User | null): boolean {
  return user !== null;
}

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

/** Các mức phạm vi hiện trên thanh lọc — 0 hoặc 1 mức thì không hiện thanh. */
export function availableScopes(
  user: User | null,
  module: ModuleKey,
  action: Action = 'view-detail',
): Scope[] {
  const widest = scopeFor(user, module, action);
  if (!widest) return [];
  return SCOPES.slice(0, scopeRank(widest) + 1);
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

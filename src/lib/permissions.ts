import {
  RoleKey,
  SCOPES,
  type Action,
  type ModuleKey,
  type Permission,
  type Scope,
  type User,
} from './types';

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
 * Chặn tự nâng quyền khi CẤP QUYỀN LẺ cho người khác (P-92/thẻ "Quyền") —
 * không phải chặn theo Chức vụ như `assignableRoles`, mà chặn theo TỪNG bộ ba
 * một. Người cấp không có `grant-permission` thì chỉ cấp được cho người khác
 * đúng bằng hoặc hẹp hơn phạm vi CHÍNH MÌNH đang có trên đúng (module, hành
 * động) đó — không cấp được cái mình không có, và không cấp rộng hơn mình.
 */
export function canGrant(actor: User | null, target: Permission): boolean {
  if (!actor) return false;
  if (can(actor, 'system', 'grant-permission')) return true;

  const ownScope = scopeFor(actor, target.module, target.action);
  if (!ownScope) return false;
  return scopeRank(ownScope) >= scopeRank(target.scope);
}

/**
 * Hạ phạm vi client xin về đúng phạm vi thật của người gọi — chặn kiểu tấn
 * công "đổi tham số scope trên URL/request thành company" (spec §1.1.6:
 * "Đổi số trên URL là xem được đơn của phòng khác"). Dùng ở MÁY CHỦ (handler
 * mock), không phải chỉ ở giao diện — ẩn nút không phải là phân quyền.
 */
export function clampScope(
  user: User | null,
  module: ModuleKey,
  action: Action,
  requested: Scope | null,
): Scope {
  const widest = scopeFor(user, module, action);
  if (!widest) return 'own';
  if (!requested) return widest;
  return scopeRank(requested) <= scopeRank(widest) ? requested : widest;
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

/** Bậc quản lý của từng chức vụ. Chỉ để so cao thấp, không phải nguồn quyền. */
const ROLE_RANK: Record<RoleKey, number> = {
  director: 4,
  'deputy-director': 3,
  head: 2,
  'deputy-head': 1,
  staff: 0,
};

/**
 * Những chức vụ người này được phép gán cho người khác.
 *
 * ⚠️ Đây là chốt chặn tự nâng quyền (spec mục 10.1). `quản trị người dùng` được
 * cấp cho nhiều người, mà gán chức vụ chính là một dạng cấp quyền — không chặn
 * thì trưởng phòng chỉ cần tạo một tài khoản vai Giám đốc rồi đăng nhập bằng
 * nó, và `cấp quyền` thành vô nghĩa.
 *
 * So theo BẬC chứ không so từng bộ ba. So từng bộ ba nghe chặt hơn nhưng sai:
 * giám đốc cố ý KHÔNG có quyền `tạo` đơn, nên xét từng bộ ba thì giám đốc không
 * gán nổi cả vai Nhân viên — đúng cái việc họ cần làm hằng ngày. Điều cần chặn
 * là gán vai CAO HƠN mình, không phải gán vai khác mình.
 *
 * Người có `cấp quyền` gán được tất cả — đó đúng là ý nghĩa của quyền đó, và
 * spec giới hạn nó ở 1–2 tài khoản.
 */
export function assignableRoles(actor: User | null): RoleKey[] {
  if (!actor || !can(actor, 'staff', 'create')) return [];
  if (can(actor, 'system', 'grant-permission')) return [...RoleKey.options];

  return RoleKey.options.filter(
    (role) => ROLE_RANK[role] <= ROLE_RANK[actor.role],
  );
}

/**
 * Bản ghi của phòng `departmentId` có nằm trong tầm của người này không.
 *
 * `departmentId` null nghĩa là không thuộc phòng nào (ban giám đốc) — chỉ phạm
 * vi `company` với tới, vì `managed`/`own` đều là danh sách phòng cụ thể.
 *
 * ⚠️ Gọi hàm này KHÔNG thay được cho `can()`: không có quyền nào thì `clampScope`
 * rơi về `own`, mà `own` lại trả về cả phòng của chính người đó. Route phải kiểm
 * `can()` trước, rồi mới kiểm phạm vi bằng hàm này.
 */
export function inVisibleScope(
  user: User | null,
  module: ModuleKey,
  action: Action,
  departmentId: string | null,
): boolean {
  const visible = visibleDepartmentIds(user, clampScope(user, module, action, null));
  if (visible === null) return true;
  if (!departmentId) return false;
  return visible.includes(departmentId);
}

/**
 * Người thao tác có đủ BẬC để đụng vào hồ sơ của người này không.
 *
 * `assignableRoles` chặn việc GÁN vai cao hơn mình, nhưng không chặn việc sửa
 * một người VỐN ĐÃ có vai cao hơn: Phó GĐ gửi `role: 'deputy-director'` cho tài
 * khoản Giám đốc là hạ cấp được ông ta, kèm `permissions: []` là xoá sạch quyền.
 * Hàm này bịt chiều đó — chặn theo vai HIỆN TẠI của mục tiêu.
 */
export function canActOn(actor: User | null, targetRole: RoleKey): boolean {
  if (!actor) return false;
  if (can(actor, 'system', 'grant-permission')) return true;
  return ROLE_RANK[targetRole] <= ROLE_RANK[actor.role];
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

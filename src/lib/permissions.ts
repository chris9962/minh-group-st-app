import { ROLE_PERMISSIONS } from './roles';
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
 * Phạm vi rộng nhất người này PHÁT được cho người khác trên (module, hành động).
 *
 * Trần PHÁT tách khỏi trần DÙNG — hai thứ khác nhau. Một người quản lý có thể
 * không tự dùng một quyền nào đó nhưng vẫn phải phát được nó cho lính: lấy
 * quyền đang cầm làm trần phát thì họ chỉ tạo được người giống hệt mình.
 *
 * Hai nguồn, lấy cái rộng hơn:
 *  1. Quyền chính mình đang cầm — cấp lại được đúng bằng hoặc hẹp hơn.
 *  2. Bộ quyền mặc định của những vai mình được gán — gán được vai nào thì phát
 *     được quyền của vai đó, kể cả quyền mình không tự dùng.
 */
export function grantScopeFor(
  actor: User | null,
  module: ModuleKey,
  action: Action,
): Scope | null {
  if (!actor) return null;
  if (can(actor, 'system', 'grant-permission')) return 'company';

  let widest = scopeFor(actor, module, action);
  for (const role of assignableRoles(actor)) {
    for (const p of ROLE_PERMISSIONS[role]) {
      /**
       * ⚠️ `grant-permission` KHÔNG BAO GIỜ đi qua nguồn 2. Đây là chốt chặn tự
       * nâng quyền, và nó phải đứng độc lập với nội dung `ROLE_PERMISSIONS`.
       *
       * Trước 06/08 chốt này là ngầm: không vai nào có `grant-permission` nên
       * vòng lặp không bao giờ tìm thấy. Ngày vai Giám đốc chuyển sang toàn
       * quyền thì chốt vỡ ngay, và vỡ im lặng — một tài khoản mang chức vụ Giám
       * đốc nhưng đã bị admin cắt quyền, chỉ còn `staff:create`, vẫn gán được
       * vai Giám đốc (cùng bậc), nên nguồn 2 lôi `grant-permission` của vai đó
       * ra làm trần phát rồi họ TỰ CẤP cho chính mình. Đã dựng lại được thật.
       *
       * Chặn thẳng ở đây thì bộ quyền vai muốn đổi thế nào cũng không đụng tới
       * chốt. Ai cần phát `grant-permission` thì phải tự đang cầm nó — nhánh
       * `can(actor, 'system', 'grant-permission')` ở trên đã lo.
       */
      if (p.action === 'grant-permission') continue;
      if ((p.module !== module && p.module !== '*') || p.action !== action) continue;
      if (!widest || scopeRank(p.scope) > scopeRank(widest)) widest = p.scope;
    }
  }
  return widest;
}

/**
 * Chặn tự nâng quyền khi CẤP QUYỀN LẺ cho người khác (P-92/thẻ "Quyền") —
 * không phải chặn theo Chức vụ như `assignableRoles`, mà chặn theo TỪNG bộ ba
 * một: không phát được rộng hơn trần phát của chính mình.
 */
export function canGrant(actor: User | null, target: Permission): boolean {
  const ceiling = grantScopeFor(actor, target.module, target.action);
  if (!ceiling) return false;
  return scopeRank(ceiling) >= scopeRank(target.scope);
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
    /**
     * `của tôi` thực chất là "phòng của tôi" (`visibleDepartmentIds`), nên nó
     * chỉ có nghĩa với người VỪA tạo bản ghi VỪA thuộc một phòng.
     *
     * Điều kiện `departmentId` là bắt buộc chứ không phải cho chắc: ban giám
     * đốc không thuộc phòng nào, nên mức này trả về danh sách phòng RỖNG và
     * chọn vào là bảng trắng, luôn luôn. Trước 06/08 vế `create` đã che được ca
     * đó vì Giám đốc không có `create`; từ khi vai này toàn quyền thì không che
     * nữa, và mức rỗng lộ ra ở cả 5 màn có thanh chọn phạm vi.
     */
    if (s === 'own') return can(user, module, 'create') && Boolean(user.departmentId);
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
 * Ai được đụng vào BẢN GHI NGHIỆP VỤ nào — tài khoản ngân hàng, đơn bảo hiểm,
 * bản ghi dịch vụ.
 *
 * ⚠️ Khác `visibleDepartmentIds` ở đúng mức hẹp nhất, và đây là chỗ code từng
 * lệch spec.
 *
 * Spec §1.1.2 định nghĩa `chỉ mình` là **bản ghi do chính mình tạo**
 * (`người tạo = tôi`). `visibleDepartmentIds` lại trả về CẢ PHÒNG của người đó,
 * nên hai nhân viên cùng phòng sửa và xoá được bản ghi của nhau — mà xoá là mất
 * hẳn, và `recomputeKpi` hạ điểm của người kia, thứ dính tới lương.
 *
 * Vì sao không sửa thẳng `visibleDepartmentIds`: nó còn phục vụ DANH BẠ NHÂN SỰ,
 * nơi `own` chỉ có thể hiểu là "phòng tôi" — bảng `users` không có cột người
 * tạo, không ai "tạo ra" một đồng nghiệp. Hai câu hỏi khác nhau thì hai hàm.
 */
export type RecordVisibility =
  /** Toàn công ty — không lọc gì. */
  | { kind: 'all' }
  /** Lọc theo phòng chụp lúc tạo bản ghi. */
  | { kind: 'departments'; departmentIds: string[] }
  /** Lọc theo NGƯỜI TẠO — đúng nghĩa `chỉ mình` của spec. */
  | { kind: 'creator'; userId: string }
  /** Không thấy dòng nào. */
  | { kind: 'none' };

export function recordVisibility(
  user: User | null,
  module: ModuleKey,
  action: Action,
): RecordVisibility {
  if (!user) return { kind: 'none' };

  // Chốt `can()` phải đứng trước: thiếu nó thì `clampScope` rơi về `own` và
  // người không có quyền vẫn thấy bản ghi của chính mình.
  const scope = scopeFor(user, module, action);
  if (!scope) return { kind: 'none' };

  if (scope === 'company') return { kind: 'all' };
  if (scope === 'managed')
    return user.managedDepartmentIds.length > 0
      ? { kind: 'departments', departmentIds: user.managedDepartmentIds }
      : // Quản 0 phòng thì `managed` là tập rỗng — không thấy gì, chứ không
        // phải rơi về phòng của mình.
        { kind: 'none' };
  return { kind: 'creator', userId: user.id };
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
 *
 * ⚠️ Bậc vai KHÔNG nói lên quyền: tài khoản quản trị mang vai Nhân viên (bậc 0)
 * mà giữ `cấp quyền`. So bậc không thôi thì Giám đốc (bậc 4) đụng được nó —
 * đặt lại mật khẩu là đọc được mật khẩu mới, đăng nhập vào là tự nâng quyền,
 * đúng cái `assignableRoles` sinh ra để chặn. Nên tài khoản giữ `cấp quyền` chỉ
 * người cùng giữ mới đụng được.
 */
export function canActOn(actor: User | null, target: User): boolean {
  if (!actor) return false;
  if (can(actor, 'system', 'grant-permission')) return true;
  if (can(target, 'system', 'grant-permission')) return false;
  if (ROLE_RANK[target.role] > ROLE_RANK[actor.role]) return false;

  /**
   * TẦM NHÌN của mục tiêu phải nằm trong tầm nhìn của người thao tác.
   *
   * So bậc không đủ. `inVisibleScope` hỏi mục tiêu THUỘC phòng nào, còn chốt
   * này hỏi mục tiêu VỚI TỚI phòng nào — hai câu hỏi khác nhau với người quản
   * phòng ngoài phòng mình. Ca thật: `quyenpgd` thuộc KD1 nhưng quản KD1+KD2,
   * nên Phó phòng KD1 đặt lại được mật khẩu của họ rồi đăng nhập vào và đọc
   * luôn KD2 — một phòng người đó không có quyền thấy.
   */
  const actorReach = reachOf(actor);
  if (actorReach === null) return true;
  const targetReach = reachOf(target);
  if (targetReach === null) return false;
  return targetReach.every((id) => actorReach.includes(id));
}

/**
 * Những phòng một người ĐỌC ĐƯỢC BẢN GHI, gộp bốn module nghiệp vụ.
 * `null` = toàn công ty.
 *
 * Chỉ soi bốn hành động ĐỌC/GHI bản ghi. Phạm vi của một hành động quản trị —
 * `manage-bank-catalog`, `configure-catalog`, `manage-referral-codes` — luôn là
 * `company` vì danh mục vốn dùng chung, và nó KHÔNG nói gì về việc người đó đọc
 * được bản ghi của phòng nào. Gộp cả chúng vào thì mọi Trưởng phòng đều thành
 * "toàn công ty" và chốt này mất tác dụng.
 *
 * Cộng phòng mình THUỘC VỀ vào danh sách phòng QUẢN: hai nguồn khác nhau, và
 * người quản 0 phòng vẫn đọc được phòng mình qua phạm vi `own` của danh bạ.
 */
const RECORD_MODULES: ModuleKey[] = ['insurance', 'banking', 'services', 'staff'];
const RECORD_ACTIONS: Action[] = ['view-summary', 'view-detail', 'update', 'delete', 'export'];

function reachOf(user: User): string[] | null {
  const ids = new Set(user.managedDepartmentIds);
  if (user.departmentId) ids.add(user.departmentId);

  for (const p of user.permissions) {
    if (p.scope !== 'company') continue;
    if (!RECORD_ACTIONS.includes(p.action)) continue;
    // `customer` nằm ngoài `RECORD_MODULES`: hồ sơ khách KHÔNG áp trục phạm vi
    // (spec §2.1b), nên `customer:view-detail` của MỌI người đều là `company`.
    // Tính nó vào thì ai cũng thành "toàn công ty" và chốt này mất tác dụng.
    if (p.module === '*' || RECORD_MODULES.includes(p.module)) return null;
  }
  return [...ids];
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

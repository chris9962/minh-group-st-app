import { can, canOrg } from './permissions';
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
  | 'profile'
  | 'target'
  | 'gift'
  | 'settings'
  | 'exports'
  | 'org'
  | 'audit'
  | 'help';

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

/**
 * Đường luôn mở cho mọi người đã đăng nhập.
 *
 * `/` phải nằm đây kể cả khi mục Tổng quan không hiện trên sidebar: nó là chỗ
 * lui về khi chặn một màn khác, mà một trang tự chặn chính nó thì thành vòng
 * chuyển hướng không dừng.
 */
/**
 * `/settings/referral-codes` nằm đây vì nó chỉ còn là đường CHUYỂN HƯỚNG sang
 * `/settings/banks` (chốt 2026-08-24). Không mở sẵn thì chính nó bị chặn trước
 * khi kịp chuyển, và mọi link cũ dẫn về trang chủ thay vì tới đúng chỗ.
 */
const ALWAYS_OPEN = ['/', '/profile', '/settings/referral-codes'];

/**
 * Người này mở được đường dẫn này không — CÙNG nguồn với sidebar.
 *
 * Đọc thẳng `navFor` chứ không dựng bảng "đường dẫn → quyền" thứ hai: hai bảng
 * rồi sẽ lệch, và lúc đó menu dẫn tới một màn bị chính nó chặn.
 *
 * Khớp theo tiền tố nên màn chi tiết đi theo màn danh sách — ai mở được
 * `/banking` thì mở được `/banking/<id>`.
 *
 * ⚠️ Đây là chốt chặn ở GIAO DIỆN, cho tiện dùng — KHÔNG phải phân quyền
 * (AGENTS.md §6). Máy chủ vẫn kiểm lại mọi lời gọi.
 */
export function canOpenPath(user: User | null, pathname: string): boolean {
  if (!user) return false;
  if (ALWAYS_OPEN.includes(pathname)) return true;

  return navFor(user)
    .flatMap((entry) => (isNavGroup(entry) ? entry.children.map((c) => c.href) : [entry.href]))
    .some((href) => href !== '/' && (pathname === href || pathname.startsWith(`${href}/`)));
}

export function navFor(user: User | null): NavEntry[] {
  if (!user) return [];

  const items: NavEntry[] = [];

  if (
    can(user, 'insurance', 'view-summary') ||
    can(user, 'banking', 'view-summary') ||
    can(user, 'services', 'view-summary')
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

  /**
   * Quà sinh ra từ combo tài khoản ngân hàng, nên màn đọc đi theo phạm vi của
   * module đó — KHÔNG theo `banking:grant-gift`, quyền kia là quyền PHÁT quà.
   */
  if (can(user, 'banking', 'view-detail')) {
    items.push({ href: '/gifts', label: 'Quà đã phát', icon: 'gift', screen: 'P-44' });
  }

  // Vào được màn Nhân sự bằng HAI đường: quản phòng thì xem điểm của lính, còn
  // `staff:create` thì vào để tạo người mới — quản trị hệ thống không quản
  // phòng nào nhưng vẫn phải mở được danh sách này.
  /**
   * ⚠️ Chỉ thêm mục Nhân sự cho người vào được. Mục "Chỉ tiêu của tôi" (P-50)
   * ĐÃ BỎ khỏi đây: nó trỏ tới `/my-target`, một trang CHƯA BAO GIỜ tồn tại, và
   * nhân viên bấm vào nhận 404 — đúng nhóm người ít có khả năng đi báo lỗi nhất.
   *
   * Nội dung của P-50 nay nằm ở màn Tổng quan: nhân viên mở nó ra thấy đúng
   * điểm, chỉ tiêu và số liệu của chính mình (chốt 06/08). Hai mục cùng dẫn tới
   * một nội dung thì thừa một mục.
   */
  if (user.manageScope !== 'none' || can(user, 'staff', 'create')) {
    items.push({ href: '/users', label: 'Nhân sự', icon: 'people', screen: 'P-51' });
  }

  // Phó giám đốc vào bằng `department:view-detail` — xem sơ đồ và số liệu,
  // không có nút sửa nào. Xem `canOrg`.
  if (canOrg(user, 'view-detail')) {
    items.push({ href: '/departments', label: 'Phòng ban', icon: 'org', screen: 'P-91' });
  }

  if (
    can(user, 'insurance', 'export') ||
    can(user, 'banking', 'export') ||
    can(user, 'services', 'export')
  ) {
    items.push({ href: '/exports', label: 'Xuất dữ liệu', icon: 'exports', screen: 'P-73' });
  }

  // Không có mục "tài khoản người dùng" riêng: nhân viên và tài khoản là một
  // thứ nên quản trị tài khoản nằm luôn trong màn Nhân sự ở trên.
  //
  // Cũng KHÔNG có mục "Phân quyền" riêng. Việc cấp quyền lẻ (P-92) đã nằm trong
  // hộp thoại sửa nhân viên — thẻ "Quyền" ở `StaffFormDialog`, dùng
  // `PermissionsEditor`. Quyền gắn với một con người cụ thể, nên sửa nó ngay tại
  // hồ sơ người đó là đúng chỗ; một màn riêng chỉ bắt người dùng đi tìm lại đúng
  // cái tên vừa mở.
  //
  // Từng có `if (can(user,'system','grant-permission'))` đẩy ra `/permissions`,
  // nhưng trang đó chưa bao giờ được dựng. Không ai phát hiện vì trước 06/08
  // không chức vụ nào cầm `grant-permission`; đến khi CEO chuyển sang toàn quyền
  // (`lib/roles.ts`) thì mục hiện ngay và bấm vào ra 404 trắng của Next.

  /**
   * "Theo dõi" gộp hai màn CHỈ ĐỌC: nhật ký hoạt động và hộp góp ý (chốt
   * 2026-08-30). Cả hai đều là bản ghi gửi về để người quản trị đọc, không màn
   * nào sửa dữ liệu nghiệp vụ — khác hẳn nhóm "Cấu hình" bên dưới.
   *
   * Hai quyền RIÊNG, mỗi mục con theo quyền của nó: ai chỉ có
   * `handle-feedback` thì nhóm hiện ra với đúng một mục.
   */
  const watchChildren: NavChild[] = [];

  // Chỉ GĐ · QTHT xem được (spec P-93) — `manage-org` đúng khớp hai vai này,
  // không dùng `view-detail` vì Kế toán tổng hợp cũng có qua wildcard `*`.
  if (can(user, 'system', 'manage-org')) {
    watchChildren.push({ href: '/audit-log', label: 'Nhật ký hoạt động', screen: 'P-93' });
  }

  // Mục này chỉ mở HỘP góp ý. Nút GỬI góp ý nằm ở chân sidebar
  // (`FeedbackButton`) và không gác quyền nào — ai đăng nhập cũng gửi được.
  if (can(user, 'system', 'handle-feedback')) {
    watchChildren.push({ href: '/feedback', label: 'Hộp góp ý', screen: 'P-96' });
  }

  if (watchChildren.length > 0) {
    items.push({ label: 'Theo dõi', icon: 'audit', children: watchChildren });
  }

  // "Cấu hình" gộp mọi màn thiết lập vào một nhóm, nhưng mục con nào hiện ra
  // vẫn theo đúng quyền riêng của nó.
  //
  // Cả bảy mục gác bằng module `system` (chốt 2026-08-24). Chúng sửa dữ liệu
  // dùng chung toàn công ty nên không thuộc module nghiệp vụ nào — trước đây
  // `insurance:configure-catalog` và `banking:manage-*` khiến vai quản lý của
  // hai module đó tự nhiên mở được màn cấu hình.
  const settingsChildren: NavChild[] = [];

  if (can(user, 'system', 'configure-gift-rules')) {
    settingsChildren.push({
      href: '/settings/gift-rules',
      label: 'Quy tắc quà & điểm',
      screen: 'P-81',
    });
  }
  if (can(user, 'system', 'configure-catalog')) {
    settingsChildren.push({
      href: '/settings/gift-catalog',
      label: 'Danh mục quà & gói BH',
      screen: 'P-82',
    });
  }
  if (can(user, 'system', 'configure-catalog')) {
    settingsChildren.push({ href: '/settings/kpi-target', label: 'Chỉ tiêu KPI', screen: 'P-83' });
  }
  if (can(user, 'system', 'configure-catalog')) {
    settingsChildren.push({
      href: '/settings/service-types',
      label: 'Loại dịch vụ',
      screen: 'P-84',
    });
  }
  /**
   * MỘT mục cho hai màn (chốt 2026-08-24). Trang `/settings/banks` dựng hai tab:
   * danh sách ngân hàng và kho mã giới thiệu.
   *
   * Một quyền thì một mục — tách hai mục ra là bày hai đường vào cùng một thứ,
   * và người dùng phải nhớ mã giới thiệu nằm ở mục nào.
   */
  /**
   * Hai quyền, hai NHÃN, cùng một đường dẫn (chốt 2026-08-24).
   *
   * `manage-bank` mở trang với cả 13 ngân hàng; `manage-assigned-banks` mở đúng
   * trang đó nhưng `visibleBankIds` lọc xuống vài ngân hàng được giao. Nhãn
   * khác nhau để người dùng biết mình đang ở phạm vi nào ngay từ sidebar.
   *
   * Nhánh `else if`: ai có cả hai quyền chỉ thấy MỘT mục — bày hai mục cùng
   * đường dẫn là hai lối vào một chỗ.
   */
  if (can(user, 'system', 'manage-bank')) {
    settingsChildren.push({
      href: '/settings/banks',
      label: 'Ngân hàng & mã giới thiệu',
      screen: 'P-60',
    });
  } else if (can(user, 'system', 'manage-assigned-banks')) {
    settingsChildren.push({
      href: '/settings/banks',
      label: 'Ngân hàng phụ trách',
      screen: 'P-60',
    });
  }
  if (can(user, 'system', 'configure-catalog')) {
    // P-71 (xã/ấp) gộp chung trang với P-70 — chỉ dùng để phục vụ kênh
    // Ấp/Định danh, không cần mục riêng trên sidebar.
    settingsChildren.push({ href: '/settings/channels', label: 'Danh mục kênh', screen: 'P-70' });
  }

  if (settingsChildren.length > 0) {
    items.push({ label: 'Cấu hình', icon: 'settings', children: settingsChildren });
  }

  // Hướng dẫn mở cho MỌI người đăng nhập — trang tự lọc BÀI theo quyền
  // (`lib/docs`), nên không gác gì ở đây.
  items.push({ href: '/docs', label: 'Hướng dẫn', icon: 'help', screen: 'P-95' });

  return items;
}

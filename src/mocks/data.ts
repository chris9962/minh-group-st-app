import { directorPermissions, managerPermissions, staffPermissions } from "@/lib/roles";
import type { Department, Permission, User } from "@/lib/types";

/** Dữ liệu giả — lấy đúng sơ đồ tổ chức thật của MGST. */

/* ── 15 phòng, danh sách phẳng ──────────────────────────────────────── */

export const departments: Department[] = [
  { id: "an-sinh", name: "Phòng An Sinh", active: true },
  { id: "y", name: "Phòng Y", active: true },
  { id: "ke-toan-th", name: "Phòng Kế toán tổng hợp", active: true },
  { id: "kinh-doanh-th", name: "Phòng Kinh doanh tổng hợp", active: true },
  { id: "du-an", name: "Phòng Dự Án", active: true },
  { id: "bao-tro-xh", name: "Phòng Bảo trợ xã hội", active: true },
  { id: "kd-1", name: "Phòng Kinh doanh 1", active: true },
  { id: "kd-2", name: "Phòng Kinh doanh 2", active: true },
  { id: "kd-3", name: "Phòng Kinh doanh 3", active: true },
  { id: "kd-4", name: "Phòng Kinh doanh 4", active: true },
  { id: "kd-5", name: "Phòng Kinh doanh 5", active: true },
  { id: "kd-6", name: "Phòng Kinh doanh 6", active: true },
  { id: "kd-7", name: "Phòng Kinh doanh 7", active: true },
  { id: "kd-8", name: "Phòng Kinh doanh 8", active: true },
  { id: "kd-9", name: "Phòng Kinh doanh 9", active: true },
];

/* ── Bộ quyền theo chức vụ ──────────────────────────────────────────── */

/** Bộ quyền theo chức vụ nằm ở `lib/roles.ts` — quy tắc chặn tự nâng quyền đọc nó. */

const p = (
  module: Permission["module"],
  action: Permission["action"],
  scope: Permission["scope"],
): Permission => ({ module, action, scope });

const sysAdminPermissions: Permission[] = [
  p("staff", "view-summary", "company"),
  p("staff", "view-detail", "company"),
  p("staff", "create", "company"),
  p("staff", "update", "company"),
  p("staff", "delete", "company"),
  p("system", "manage-org", "company"),
  p("system", "grant-permission", "company"),
  p("*", "view-detail", "company"),
  p("*", "update", "company"),
  // Cấu hình (P-81…P-84): để cùng Giám đốc cấu hình được, không chỉ mỗi CEO.
  p("*", "configure-catalog", "company"),
  p("*", "configure-gift-rules", "company"),
];

const orderDeskPermissions: Permission[] = [
  p("insurance", "view-detail", "company"),
  p("insurance", "handle-fallback", "company"),
];

const salesOpsPermissions: Permission[] = [
  p("banking", "view-detail", "company"),
  p("banking", "view-summary", "company"),
  p("banking", "export", "company"),
  p("banking", "manage-referral-codes", "company"),
  p("banking", "manage-bank-catalog", "company"),
];

const accountingOpsPermissions: Permission[] = [
  p("*", "view-detail", "company"),
  p("*", "view-summary", "company"),
  p("*", "export", "company"),
  p("*", "configure-catalog", "company"),
];

/* ── Người dùng ─────────────────────────────────────────────────────── */

export type MockAccount = User & { password: string };

const account = (
  a: Omit<MockAccount, "wardId" | "active"> & Partial<Pick<MockAccount, "wardId">>,
): MockAccount => ({ wardId: null, active: true, ...a });

export let mockUsers: MockAccount[] = [
  account({
    id: "u-director",
    username: "giamdoc",
    password: "12345678",
    fullName: "Đinh Hoàng Công",
    title: "Giám đốc",
    role: "director",
    departmentId: null,
    managedDepartmentIds: [],
    manageScope: "company",
    permissions: directorPermissions,
  }),
  account({
    id: "u-advisor",
    username: "covan",
    password: "12345678",
    fullName: "Đinh Hoàng Minh",
    title: "Cố vấn cao cấp",
    role: "deputy-director",
    departmentId: null,
    managedDepartmentIds: ["ke-toan-th", "kinh-doanh-th"],
    manageScope: "listed",
    permissions: managerPermissions,
  }),
  account({
    id: "u-dd1",
    username: "pgd1",
    password: "12345678",
    fullName: "Phan Hữu Linh",
    title: "Phó Giám Đốc 1",
    role: "deputy-director",
    departmentId: null,
    managedDepartmentIds: ["du-an", "bao-tro-xh"],
    manageScope: "listed",
    permissions: managerPermissions,
  }),
  account({
    id: "u-dd2",
    username: "pgd2",
    password: "12345678",
    fullName: "Nguyễn Thị Hồng Huệ",
    title: "Phó Giám Đốc 2",
    role: "deputy-director",
    departmentId: null,
    managedDepartmentIds: ["kd-2", "kd-6", "kd-7"],
    manageScope: "listed",
    permissions: managerPermissions,
  }),
  account({
    id: "u-dd3",
    username: "pgd3",
    password: "12345678",
    fullName: "Lư Hồng Huỳnh",
    title: "Phó Giám Đốc 3",
    role: "deputy-director",
    departmentId: null,
    managedDepartmentIds: ["kd-3", "kd-4", "kd-5", "kd-9"],
    manageScope: "listed",
    permissions: managerPermissions,
  }),
  account({
    id: "u-dd4",
    username: "quyenpgd",
    password: "12345678",
    fullName: "Dương Minh Trường",
    title: "Quyền Phó Giám Đốc",
    role: "deputy-director",
    departmentId: null,
    managedDepartmentIds: ["kd-1", "kd-8"],
    manageScope: "listed",
    permissions: managerPermissions,
  }),
  account({
    id: "u-head-kd2",
    username: "tpkd2",
    password: "12345678",
    fullName: "Trần Văn Hậu",
    title: "Trưởng phòng Kinh doanh 2",
    role: "head",
    departmentId: "kd-2",
    managedDepartmentIds: ["kd-2"],
    manageScope: "listed",
    permissions: managerPermissions,
  }),
  account({
    // "p2" chứ không phải "u-staff": người này cũng nằm trong danh sách P-51
    // (mocks/people.ts) với id p2 — một người MỘT id, nếu không thì bản ghi
    // nghiệp vụ tạo bởi p2 và phiên đăng nhập u-staff không nhận ra nhau.
    id: "p2",
    username: "ntbtram",
    password: "12345678",
    fullName: "Nguyễn Thị Bích Trâm",
    title: "Nhân viên kinh doanh",
    role: "staff",
    departmentId: "kd-2",
    managedDepartmentIds: [],
    manageScope: "none",
    permissions: staffPermissions,
  }),
  account({
    id: "u-sysadmin",
    username: "quantri",
    password: "12345678",
    fullName: "Phạm Thu Hà",
    title: "Quản trị hệ thống",
    role: "staff",
    departmentId: null,
    managedDepartmentIds: [],
    manageScope: "company",
    permissions: sysAdminPermissions,
  }),
  account({
    id: "u-orderdesk",
    username: "taodon",
    password: "12345678",
    fullName: "Võ Thanh Tùng",
    title: "Đội tạo đơn",
    role: "staff",
    departmentId: "kinh-doanh-th",
    managedDepartmentIds: [],
    manageScope: "company",
    permissions: orderDeskPermissions,
  }),
  account({
    id: "u-salesops",
    username: "kdth",
    password: "12345678",
    fullName: "Đặng Ngọc Mai",
    title: "Kinh doanh tổng hợp",
    role: "staff",
    departmentId: "kinh-doanh-th",
    managedDepartmentIds: [],
    manageScope: "company",
    permissions: salesOpsPermissions,
  }),
  account({
    id: "u-acctops",
    username: "ktth",
    password: "12345678",
    fullName: "Huỳnh Kim Ngân",
    title: "Kế toán tổng hợp",
    role: "staff",
    departmentId: "ke-toan-th",
    managedDepartmentIds: [],
    manageScope: "company",
    permissions: accountingOpsPermissions,
  }),
];

/**
 * Sửa quyền của một người qua màn Nhân sự (P-53/P-92) phải ảnh hưởng luôn tới
 * PHIÊN ĐĂNG NHẬP thật — không chỉ đổi cho có ở hồ sơ nhân sự. `mockUsers` là
 * nguồn duy nhất `/api/login` và mọi handler tra `actorBy` đọc, nên phải sửa
 * đúng chỗ này. Khớp theo `username` vì đó là khoá duy nhất chung giữa
 * `StaffAccount` (kho ở `mocks/staff.ts`) và tài khoản đăng nhập ở đây.
 */
export function setMockUserPermissions(username: string, permissions: Permission[]): void {
  mockUsers = mockUsers.map((u) => (u.username === username ? { ...u, permissions } : u));
}

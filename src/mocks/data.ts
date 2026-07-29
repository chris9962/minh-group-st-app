import type { OrgUnit, Permission, User } from "@/lib/types";

/** Dữ liệu giả — thay bằng API thật sau. Tên và số liệu lấy đúng như trong bản thiết kế. */

export const orgUnits: OrgUnit[] = [
  { id: "co", name: "Minh Group ST", type: "company", parentId: null, active: true },
  { id: "br-ct", name: "Chi nhánh Cần Thơ", type: "branch", parentId: "co", active: true },
  { id: "sales-1", name: "Phòng KD 1", type: "department", parentId: "br-ct", active: true },
  { id: "sales-2", name: "Phòng KD 2", type: "department", parentId: "br-ct", active: true },
  { id: "sales-1-t2", name: "Nhóm 2", type: "team", parentId: "sales-1", active: true },
  { id: "sales-ops", name: "Kinh doanh tổng hợp", type: "department", parentId: "co", active: true },
  { id: "acct-ops", name: "Kế toán tổng hợp", type: "department", parentId: "co", active: true },
  { id: "order-desk", name: "Đội tạo đơn", type: "department", parentId: "co", active: true },
  { id: "projects", name: "Phòng Dự án", type: "department", parentId: "co", active: true },
];

const p = (
  module: Permission["module"],
  action: Permission["action"],
  scope: Permission["scope"],
): Permission => ({ module, action, scope });

/** Nhân viên kinh doanh — phạm vi hẹp nhất, không hiện thanh chọn phạm vi. */
const salesRepPermissions: Permission[] = [
  p("insurance", "view-stats", "own"),
  p("insurance", "view-detail", "own"),
  p("insurance", "create", "own"),
  p("insurance", "update", "own"),
  p("insurance", "download", "own"),
  p("banking", "view-stats", "own"),
  p("banking", "view-detail", "own"),
  p("banking", "create", "own"),
  p("banking", "grant-gift", "own"),
  p("services", "view-detail", "own"),
  p("services", "create", "own"),
];

/** Trưởng phòng — cùng bộ hành động, chỉ khác phạm vi. `create` vẫn là `own`. */
const departmentHeadPermissions: Permission[] = [
  ...salesRepPermissions.map((x) =>
    x.action === "create" ? x : { ...x, scope: "department" as const },
  ),
  p("insurance", "export-excel", "department"),
  p("banking", "export-excel", "department"),
];

const executivePermissions: Permission[] = [
  p("*", "view-stats", "company"),
  p("*", "view-detail", "company"),
  p("*", "download", "company"),
  p("*", "export-excel", "company"),
  p("*", "configure-catalog", "company"),
  p("*", "configure-gift-rules", "company"),
  p("*", "grant-gift", "company"),
];

const sysAdminPermissions: Permission[] = [
  p("system", "manage-users", "company"),
  p("system", "grant-permission", "company"),
  p("*", "view-detail", "company"),
  p("*", "update", "company"),
];

const orderDeskPermissions: Permission[] = [
  p("insurance", "view-detail", "company"),
  p("insurance", "handle-fallback", "company"),
  p("insurance", "download", "company"),
];

const salesOpsPermissions: Permission[] = [
  p("banking", "view-detail", "company"),
  p("banking", "view-stats", "company"),
  p("banking", "export-excel", "company"),
  p("banking", "manage-codes", "company"),
  p("banking", "configure-catalog", "company"),
];

const accountingOpsPermissions: Permission[] = [
  p("*", "view-detail", "company"),
  p("*", "view-stats", "company"),
  p("*", "export-excel", "company"),
  p("*", "configure-catalog", "company"),
];

export type MockAccount = User & { password: string };

export const mockUsers: MockAccount[] = [
  {
    id: "u1",
    username: "ntbtram",
    password: "12345678",
    fullName: "Nguyễn Thị Bích Trâm",
    orgUnitId: "sales-1-t2",
    wardId: null,
    roleName: "Nhân viên kinh doanh",
    permissions: salesRepPermissions,
    active: true,
  },
  {
    id: "u2",
    username: "tvhau",
    password: "12345678",
    fullName: "Trần Văn Hậu",
    orgUnitId: "sales-1",
    wardId: null,
    roleName: "Trưởng phòng KD 1",
    permissions: departmentHeadPermissions,
    active: true,
  },
  {
    id: "u3",
    username: "giamdoc",
    password: "12345678",
    fullName: "Lê Minh Quân",
    orgUnitId: "co",
    wardId: null,
    roleName: "Ban giám đốc",
    permissions: executivePermissions,
    active: true,
  },
  {
    id: "u4",
    username: "quantri",
    password: "12345678",
    fullName: "Phạm Thu Hà",
    orgUnitId: "co",
    wardId: null,
    roleName: "Quản trị hệ thống",
    permissions: sysAdminPermissions,
    active: true,
  },
  {
    id: "u5",
    username: "taodon",
    password: "12345678",
    fullName: "Võ Thanh Tùng",
    orgUnitId: "order-desk",
    wardId: null,
    roleName: "Đội tạo đơn",
    permissions: orderDeskPermissions,
    active: true,
  },
  {
    id: "u6",
    username: "kdth",
    password: "12345678",
    fullName: "Đặng Ngọc Mai",
    orgUnitId: "sales-ops",
    wardId: null,
    roleName: "Kinh doanh tổng hợp",
    permissions: salesOpsPermissions,
    active: true,
  },
  {
    id: "u7",
    username: "ktth",
    password: "12345678",
    fullName: "Huỳnh Kim Ngân",
    orgUnitId: "acct-ops",
    wardId: null,
    roleName: "Kế toán tổng hợp",
    permissions: accountingOpsPermissions,
    active: true,
  },
];

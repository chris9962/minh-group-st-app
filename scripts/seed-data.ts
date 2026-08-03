import {
  directorPermissions,
  managerPermissions,
  staffPermissions,
} from "../src/lib/roles";
import type { ManageScope, Permission, RoleKey } from "../src/lib/types";

/**
 * Dữ liệu khởi tạo THẬT — cấu trúc tổ chức + danh mục theo spec, KHÔNG có
 * dữ liệu nghiệp vụ giả (khách, tài khoản, đơn, điểm…). App bắt đầu trống
 * như ngày đầu công ty dùng thật.
 *
 * Đứng độc lập, không import từ src/mocks — mock đã bị gỡ khỏi dự án.
 * Tham chiếu chéo (tài khoản→phòng, quy tắc quà→ngân hàng/món quà…) đi bằng
 * TÊN/CODE, script seed tự tra ra uuid lúc chèn.
 */

const p = (
  module: Permission["module"],
  action: Permission["action"],
  scope: Permission["scope"],
): Permission => ({ module, action, scope });

/* ── 15 phòng — sơ đồ thật của MGST ─────────────────────────────────── */

export const DEPARTMENTS: string[] = [
  "Phòng An Sinh",
  "Phòng Y",
  "Phòng Kế toán tổng hợp",
  "Phòng Kinh doanh tổng hợp",
  "Phòng Dự Án",
  "Phòng Bảo trợ xã hội",
  "Phòng Kinh doanh 1",
  "Phòng Kinh doanh 2",
  "Phòng Kinh doanh 3",
  "Phòng Kinh doanh 4",
  "Phòng Kinh doanh 5",
  "Phòng Kinh doanh 6",
  "Phòng Kinh doanh 7",
  "Phòng Kinh doanh 8",
  "Phòng Kinh doanh 9",
];

/* ── Bộ quyền theo vị trí đặc thù (ngoài 3 bộ theo chức vụ ở lib/roles) ── */

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

export type SeedAccount = {
  username: string;
  fullName: string;
  title: string;
  role: RoleKey;
  departmentName: string | null;
  manageScope: ManageScope;
  managedDepartmentNames: string[];
  permissions: Permission[];
};

/** 12 tài khoản khởi tạo — mật khẩu demo chung `12345678`, đổi qua C-02. */
export const ACCOUNTS: SeedAccount[] = [
  {
    username: "giamdoc",
    fullName: "Đinh Hoàng Công",
    title: "Giám đốc",
    role: "director",
    departmentName: null,
    manageScope: "company",
    managedDepartmentNames: [],
    permissions: directorPermissions,
  },
  {
    username: "covan",
    fullName: "Đinh Hoàng Minh",
    title: "Cố vấn cao cấp",
    role: "deputy-director",
    departmentName: null,
    manageScope: "listed",
    managedDepartmentNames: ["Phòng Kế toán tổng hợp", "Phòng Kinh doanh tổng hợp"],
    permissions: managerPermissions,
  },
  {
    username: "pgd1",
    fullName: "Phan Hữu Linh",
    title: "Phó Giám Đốc 1",
    role: "deputy-director",
    departmentName: null,
    manageScope: "listed",
    managedDepartmentNames: ["Phòng Dự Án", "Phòng Bảo trợ xã hội"],
    permissions: managerPermissions,
  },
  {
    username: "pgd2",
    fullName: "Nguyễn Thị Hồng Huệ",
    title: "Phó Giám Đốc 2",
    role: "deputy-director",
    departmentName: null,
    manageScope: "listed",
    managedDepartmentNames: ["Phòng Kinh doanh 2", "Phòng Kinh doanh 6", "Phòng Kinh doanh 7"],
    permissions: managerPermissions,
  },
  {
    username: "pgd3",
    fullName: "Lư Hồng Huỳnh",
    title: "Phó Giám Đốc 3",
    role: "deputy-director",
    departmentName: null,
    manageScope: "listed",
    managedDepartmentNames: [
      "Phòng Kinh doanh 3",
      "Phòng Kinh doanh 4",
      "Phòng Kinh doanh 5",
      "Phòng Kinh doanh 9",
    ],
    permissions: managerPermissions,
  },
  {
    username: "quyenpgd",
    fullName: "Dương Minh Trường",
    title: "Quyền Phó Giám Đốc",
    role: "deputy-director",
    departmentName: null,
    manageScope: "listed",
    managedDepartmentNames: ["Phòng Kinh doanh 1", "Phòng Kinh doanh 8"],
    permissions: managerPermissions,
  },
  {
    username: "tpkd2",
    fullName: "Trần Văn Hậu",
    title: "Trưởng phòng Kinh doanh 2",
    role: "head",
    departmentName: "Phòng Kinh doanh 2",
    manageScope: "listed",
    managedDepartmentNames: ["Phòng Kinh doanh 2"],
    permissions: managerPermissions,
  },
  {
    username: "ntbtram",
    fullName: "Nguyễn Thị Bích Trâm",
    title: "Nhân viên kinh doanh",
    role: "staff",
    departmentName: "Phòng Kinh doanh 2",
    manageScope: "none",
    managedDepartmentNames: [],
    permissions: staffPermissions,
  },
  {
    username: "quantri",
    fullName: "Phạm Thu Hà",
    title: "Quản trị hệ thống",
    role: "staff",
    departmentName: null,
    manageScope: "company",
    managedDepartmentNames: [],
    permissions: sysAdminPermissions,
  },
  {
    username: "taodon",
    fullName: "Võ Thanh Tùng",
    title: "Đội tạo đơn",
    role: "staff",
    departmentName: "Phòng Kinh doanh tổng hợp",
    manageScope: "company",
    managedDepartmentNames: [],
    permissions: orderDeskPermissions,
  },
  {
    username: "kdth",
    fullName: "Đặng Ngọc Mai",
    title: "Kinh doanh tổng hợp",
    role: "staff",
    departmentName: "Phòng Kinh doanh tổng hợp",
    manageScope: "company",
    managedDepartmentNames: [],
    permissions: salesOpsPermissions,
  },
  {
    username: "ktth",
    fullName: "Huỳnh Kim Ngân",
    title: "Kế toán tổng hợp",
    role: "staff",
    departmentName: "Phòng Kế toán tổng hợp",
    manageScope: "company",
    managedDepartmentNames: [],
    permissions: accountingOpsPermissions,
  },
];

/* ── Danh mục ngân hàng — spec §2.6, không phải danh mục tự đặt ─────── */

export const BANKS = [
  { code: "MB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "VPa", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "VPb", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1.4", countsAsApp: true },
  { code: "LBP", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "MSBa", requiredPhotos: 3, accountNumberMethod: "manual", coefficient: "1", countsAsApp: true },
  { code: "MSBb", requiredPhotos: 3, accountNumberMethod: "manual", coefficient: "1", countsAsApp: true },
  { code: "TCB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "BIDV", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "TPB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "VIB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "SHB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "CNKD", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: false },
  { code: "HKD", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: false },
] as const;

/** Kho mã khởi điểm — stock sạch (chưa dùng lượt nào), KDTH quản qua P-61/P-62. */
export const REFERRAL_CODES = [
  { bankCode: "VPa", code: "VPA-2026-01", total: 100 },
  { bankCode: "VPa", code: "VPA-2026-02", total: 100 },
  { bankCode: "MSBa", code: "MSBA-01", total: 100 },
  { bankCode: "TPB", code: "TPB-01", total: 100 },
  { bankCode: "MB", code: "MB-01", total: 50 },
  { bankCode: "VPb", code: "VPB-2026-01", total: 100 },
] as const;

/* ── Kênh — spec §2.3 ───────────────────────────────────────────────── */

export const CHANNELS = [
  { name: "Ấp", inputKind: "ward-hamlet" },
  { name: "Định danh", inputKind: "ward-hamlet" },
  { name: "Bệnh viện", inputKind: "hospital" },
  { name: "Tự do", inputKind: "free-text" },
  { name: "ATM", inputKind: "none" },
] as const;

export const HOSPITALS: string[] = [
  "Bệnh viện Đa khoa Tân Bình",
  "Bệnh viện Chợ Rẫy",
  "Bệnh viện Nhân dân 115",
  "Bệnh viện Nhi đồng 1",
  "Quân y Cà Mau",
  "Quân y Bạc Liêu",
  "Quân y Sóc Trăng",
  "Thạnh Trị",
  "Ngã Năm",
  "Phước Long",
  "Châu Thành",
  "Mỹ Tú",
  "Long Mỹ",
  "Hòa Bình",
];

/* ── Dịch vụ, quà, gói bảo hiểm — spec §6, §5.2, P-82 ───────────────── */

export const SERVICE_TYPES = [
  { name: "Thanh toán hoá đơn", coefficient: "1" },
  { name: "Nạp / rút", coefficient: "1" },
  { name: "Thủ tục hành chính", coefficient: "1" },
  { name: "Bảo hiểm xã hội", coefficient: "1" },
  { name: "Bảo hiểm y tế", coefficient: "1" },
] as const;

export const GIFT_ITEMS: string[] = ["Loa", "Bảng mica", "Mì", "Nón bảo hiểm", "BH sức khoẻ"];

export const INSURANCE_PACKAGES = [
  { name: "1 năm BH xe máy", yearlyFee: 100000 },
  { name: "1 năm BH tai nạn điện", yearlyFee: 100000 },
  { name: "1 năm xe máy + 1 năm tai nạn điện", yearlyFee: 200000 },
  { name: "2 năm BH xe máy", yearlyFee: 200000 },
  { name: "2 năm tai nạn điện gói 100k", yearlyFee: 200000 },
  { name: "1 năm tai nạn điện gói 200k", yearlyFee: 200000 },
] as const;

/** Bảng quy tắc quà khởi điểm — khớp spec §5.2; CEO chỉnh tiếp ở P-81. */
export type SeedGiftRule = {
  sortOrder: number;
  giftGroup: "cash" | "choice";
  mode: "accumulate" | "tiered" | "addon";
  requiredBankCode: string | null;
  requiresCnkd: boolean;
  appCountComparator: "none" | "eq" | "gte";
  appCountValue: number | null;
  channelName: string | null;
  cashAmount: number | null;
  /** Tên món — tra ở gift_items trước, không có thì insurance_packages. */
  itemNames: string[];
  effectiveFrom: string;
};

export const GIFT_RULES: SeedGiftRule[] = [
  {
    sortOrder: 1, giftGroup: "cash", mode: "accumulate",
    requiredBankCode: "VPa", requiresCnkd: false,
    appCountComparator: "none", appCountValue: null,
    channelName: null, cashAmount: 20000, itemNames: [],
    effectiveFrom: "2026-01-01",
  },
  {
    sortOrder: 2, giftGroup: "cash", mode: "accumulate",
    requiredBankCode: "MSBa", requiresCnkd: false,
    appCountComparator: "eq", appCountValue: 3,
    channelName: null, cashAmount: 50000, itemNames: [],
    effectiveFrom: "2026-01-01",
  },
  {
    sortOrder: 3, giftGroup: "choice", mode: "tiered",
    requiredBankCode: "MSBa", requiresCnkd: false,
    appCountComparator: "gte", appCountValue: 3,
    channelName: null, cashAmount: null,
    itemNames: ["1 năm BH xe máy", "1 năm BH tai nạn điện"],
    effectiveFrom: "2026-01-01",
  },
  {
    sortOrder: 4, giftGroup: "choice", mode: "tiered",
    requiredBankCode: null, requiresCnkd: false,
    appCountComparator: "gte", appCountValue: 3,
    channelName: null, cashAmount: null,
    itemNames: [
      "1 năm xe máy + 1 năm tai nạn điện",
      "2 năm BH xe máy",
      "2 năm tai nạn điện gói 100k",
      "1 năm tai nạn điện gói 200k",
    ],
    effectiveFrom: "2026-01-01",
  },
  {
    sortOrder: 5, giftGroup: "choice", mode: "tiered",
    requiredBankCode: null, requiresCnkd: false,
    appCountComparator: "gte", appCountValue: 2,
    channelName: null, cashAmount: null,
    itemNames: ["1 năm BH xe máy", "1 năm BH tai nạn điện"],
    effectiveFrom: "2026-01-01",
  },
  {
    sortOrder: 6, giftGroup: "choice", mode: "addon",
    requiredBankCode: "VPa", requiresCnkd: true,
    appCountComparator: "none", appCountValue: null,
    channelName: null, cashAmount: null,
    itemNames: ["Loa", "Bảng mica"],
    effectiveFrom: "2026-01-01",
  },
  {
    sortOrder: 7, giftGroup: "choice", mode: "addon",
    requiredBankCode: null, requiresCnkd: false,
    appCountComparator: "none", appCountValue: null,
    channelName: "Bệnh viện", cashAmount: null,
    itemNames: ["Mì", "BH sức khoẻ", "Nón bảo hiểm"],
    effectiveFrom: "2026-01-01",
  },
];

/** Chỉ tiêu KPI khởi điểm — 100 điểm/tháng, cảnh báo khi còn 7 ngày (P-83). */
export const KPI_TARGET = { monthlyPoints: 100, warnDaysLeft: 7 };

import { directorPermissions, managerPermissions } from "../src/lib/roles";
import type { ManageScope, Permission, RoleKey } from "../src/lib/types";

/**
 * Dữ liệu khởi tạo THẬT — cấu trúc tổ chức + danh mục theo spec, KHÔNG có
 * dữ liệu nghiệp vụ giả (khách, tài khoản, đơn, điểm…). App bắt đầu trống
 * như ngày đầu công ty dùng thật.
 *
 * Đứng độc lập, không import từ src/mocks — mock đã bị gỡ khỏi dự án.
 * Tham chiếu chéo (tài khoản→phòng, quy tắc→ngân hàng/món quà…) đi bằng MÃ
 * `code`, script seed tra ra uuid lúc chèn — không tra theo TÊN vì tên sửa
 * được ở giao diện, gõ lệch một chữ là quan hệ rơi mất trong im lặng.
 */

const p = (
  module: Permission["module"],
  action: Permission["action"],
  scope: Permission["scope"],
): Permission => ({ module, action, scope });

/* ── 15 phòng — sơ đồ thật của MGST ─────────────────────────────────── */

export const DEPARTMENTS: { code: string; name: string }[] = [
  { code: "PHONG-AN-SINH", name: "Phòng An Sinh" },
  { code: "PHONG-Y", name: "Phòng Y" },
  { code: "PHONG-KTTH", name: "Phòng Kế toán tổng hợp" },
  { code: "PHONG-KDTH", name: "Phòng Kinh doanh tổng hợp" },
  { code: "PHONG-DU-AN", name: "Phòng Dự Án" },
  { code: "PHONG-BTXH", name: "Phòng Bảo trợ xã hội" },
  { code: "KD-1", name: "Phòng Kinh doanh 1" },
  { code: "KD-2", name: "Phòng Kinh doanh 2" },
  { code: "KD-3", name: "Phòng Kinh doanh 3" },
  { code: "KD-4", name: "Phòng Kinh doanh 4" },
  { code: "KD-5", name: "Phòng Kinh doanh 5" },
  { code: "KD-6", name: "Phòng Kinh doanh 6" },
  { code: "KD-7", name: "Phòng Kinh doanh 7" },
  { code: "KD-8", name: "Phòng Kinh doanh 8" },
  { code: "KD-9", name: "Phòng Kinh doanh 9" },
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

/* Các bộ quyền vị trí đặc thù khác (đội tạo đơn, KDTH, KTTH…) cấp qua P-53/P-92
   khi tạo người thật — không seed tài khoản ảo kèm theo nữa (duyệt 03/08). */

export type SeedAccount = {
  username: string;
  fullName: string;
  title: string;
  role: RoleKey;
  /**
   * Mã nhân viên. Bảy tài khoản khởi tạo có trước khi trường này thành bắt buộc
   * nên đang mang mã TẠM `TMP-*`: để trống thì form P-52 chặn không cho sửa gì,
   * kể cả đổi số điện thoại. Có mã thật thì sửa thẳng ở P-52, không cần seed lại.
   */
  staffCode: string;
  /** Mã phòng THUỘC VỀ — null với ban giám đốc. Tra theo `code`, không theo tên. */
  departmentCode: string | null;
  manageScope: ManageScope;
  /** Mã các phòng QUẢN LÝ. Seed sẽ dừng hẳn nếu có mã không tồn tại. */
  managedDepartmentCodes: string[];
  permissions: Permission[];
};

/**
 * Tài khoản khởi tạo (duyệt 03/08): CHỈ Ban giám đốc (người thật) + một tài
 * khoản hệ thống `admin` giữ quyền cấp quyền (spec §10.1: grant-permission ở
 * 1-2 tài khoản quản trị — Giám đốc cố ý không có, thiếu admin là không cấp
 * nổi quyền nghiệp vụ cho nhân viên mới). Mật khẩu demo chung `12345678`,
 * đổi qua C-02 khi dùng thật. Nhân viên các phòng nhập tay qua P-53.
 */
export const ACCOUNTS: SeedAccount[] = [
  {
    username: "giamdoc",
    staffCode: "TMP-GIAMDOC",
    fullName: "Đinh Hoàng Công",
    title: "Giám đốc",
    role: "director",
    departmentCode: null,
    manageScope: "company",
    managedDepartmentCodes: [],
    permissions: directorPermissions,
  },
  {
    username: "covan",
    staffCode: "TMP-COVAN",
    fullName: "Đinh Hoàng Minh",
    title: "Cố vấn cao cấp",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["PHONG-KTTH", "PHONG-KDTH"],
    permissions: managerPermissions,
  },
  {
    username: "pgd1",
    staffCode: "TMP-PGD1",
    fullName: "Phan Hữu Linh",
    title: "Phó Giám Đốc 1",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["PHONG-DU-AN", "PHONG-BTXH"],
    permissions: managerPermissions,
  },
  {
    username: "pgd2",
    staffCode: "TMP-PGD2",
    fullName: "Nguyễn Thị Hồng Huệ",
    title: "Phó Giám Đốc 2",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["KD-2", "KD-6", "KD-7"],
    permissions: managerPermissions,
  },
  {
    username: "pgd3",
    staffCode: "TMP-PGD3",
    fullName: "Lư Hồng Huỳnh",
    title: "Phó Giám Đốc 3",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["KD-3", "KD-4", "KD-5", "KD-9"],
    permissions: managerPermissions,
  },
  {
    username: "quyenpgd",
    staffCode: "TMP-QUYENPGD",
    fullName: "Dương Minh Trường",
    title: "Quyền Phó Giám Đốc",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["KD-1", "KD-8"],
    permissions: managerPermissions,
  },
  {
    // Tài khoản HỆ THỐNG, không phải người ảo — giao cho ai đảm nhiệm thì
    // đổi username/mật khẩu của chính tài khoản này.
    username: "admin",
    staffCode: "TMP-ADMIN",
    fullName: "User Admin",
    title: "Quản trị hệ thống",
    role: "staff",
    departmentCode: null,
    manageScope: "company",
    managedDepartmentCodes: [],
    permissions: sysAdminPermissions,
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

/* Kho mã giới thiệu KHÔNG seed (duyệt 03/08 — mã mẫu là số bịa): bắt đầu rỗng,
   KDTH nhập mã thật qua P-61/P-62. */

/* ── Kênh — spec §2.3 ───────────────────────────────────────────────── */

export const CHANNELS = [
  { code: "KENH-AP", name: "Ấp", inputKind: "ward-hamlet" },
  { code: "KENH-DINH-DANH", name: "Định danh", inputKind: "ward-hamlet" },
  { code: "KENH-BENH-VIEN", name: "Bệnh viện", inputKind: "hospital" },
  { code: "KENH-TU-DO", name: "Tự do", inputKind: "free-text" },
  { code: "KENH-ATM", name: "ATM", inputKind: "none" },
] as const;

/** Danh sách thật do người dùng chốt 03/08. */
export const HOSPITALS: string[] = [
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

export const GIFT_ITEMS = [
  { code: "QUA-LOA", name: "Loa" },
  { code: "QUA-MICA", name: "Bảng mica" },
  { code: "QUA-MI", name: "Mì" },
  { code: "QUA-NON-BH", name: "Nón bảo hiểm" },
  { code: "QUA-BH-SUC-KHOE", name: "BH sức khoẻ" },
] as const;

/**
 * MỘT LEG = MỘT ĐƠN bảo hiểm (chốt 04/08). `fee` là phí TRỌN THỜI HẠN của đơn
 * leg đó sinh ra, không phải phí mỗi năm.
 *
 * `name` chỉ để hiển thị — không code nào được đọc nó để suy ra sản phẩm, số
 * năm hay số đơn. Cấu trúc khai tường minh ở đây.
 */
export const INSURANCE_PACKAGES = [
  /** Xe máy có hợp đồng nhiều năm THẬT — một đơn dài, không tách. */
  { code: "BH-1N-XEMAY", name: "1 năm BH xe máy",
    legs: [{ product: "motorbike", years: 1, fee: 100000 }] },
  { code: "BH-2N-XEMAY", name: "2 năm BH xe máy",
    legs: [{ product: "motorbike", years: 2, fee: 200000 }] },
  { code: "BH-3N-XEMAY", name: "3 năm BH xe máy",
    legs: [{ product: "motorbike", years: 3, fee: 300000 }] },

  { code: "BH-1N-DIEN", name: "1 năm BH tai nạn điện",
    legs: [{ product: "electric-accident", years: 1, fee: 100000 }] },
  { code: "BH-1N-DIEN-200K", name: "1 năm tai nạn điện gói 200k",
    legs: [{ product: "electric-accident", years: 1, fee: 200000 }] },

  /** Hãng chỉ phát hành hợp đồng tai nạn điện 1 năm → gói 2 năm là HAI leg. */
  { code: "BH-2N-DIEN-100K", name: "2 năm tai nạn điện gói 100k",
    legs: [
      { product: "electric-accident", years: 1, fee: 100000 },
      { product: "electric-accident", years: 1, fee: 100000 },
    ] },

  /** Gói ghép chỉ khác gói trên ở `product` của từng leg. */
  { code: "BH-COMBO-1N", name: "1 năm xe máy + 1 năm tai nạn điện",
    legs: [
      { product: "motorbike", years: 1, fee: 100000 },
      { product: "electric-accident", years: 1, fee: 100000 },
    ] },
] as const;

/* Quy tắc quà KHÔNG còn ở đây: thể lệ nằm trong module code theo kỳ
   `src/rules/YYYY-MM.ts` (spec §5.3), tài liệu nguồn ở `mgst-the-le/`. */

/** Chỉ tiêu KPI khởi điểm — 100 điểm/tháng, cảnh báo khi còn 7 ngày (P-83). */
export const KPI_TARGET = { monthlyPoints: 100, warnDaysLeft: 7 };

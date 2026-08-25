import { deputyDirectorPermissions, directorPermissions, managerPermissions } from "../src/lib/roles";
import type { DepartmentType, ManageScope, Permission, RoleKey } from "../src/lib/types";

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

/**
 * `type` quyết định công thức tính điểm KPI (spec §7.0, chốt 2026-08-22).
 *
 * 11 phòng `sales`: KD-1…KD-9, cộng Phòng Y và Phòng Dự Án — hai phòng này cũng
 * phục vụ khách. Bốn phòng `office` CHƯA có công thức nào, kể cả `PHONG-KDTH`:
 * phòng đó giữ kho mã và kho ngân hàng chứ không mở tài khoản cho khách.
 */
export const DEPARTMENTS: { code: string; name: string; type: DepartmentType }[] = [
  { code: "PHONG-AN-SINH", name: "Phòng An Sinh", type: "office" },
  { code: "PHONG-Y", name: "Phòng Y", type: "sales" },
  { code: "PHONG-KTTH", name: "Phòng Kế toán tổng hợp", type: "office" },
  { code: "PHONG-KDTH", name: "Phòng Kinh doanh tổng hợp", type: "office" },
  { code: "PHONG-DU-AN", name: "Phòng Dự Án", type: "sales" },
  { code: "PHONG-BTXH", name: "Phòng Bảo trợ xã hội", type: "office" },
  { code: "KD-1", name: "Phòng Kinh doanh 1", type: "sales" },
  { code: "KD-2", name: "Phòng Kinh doanh 2", type: "sales" },
  { code: "KD-3", name: "Phòng Kinh doanh 3", type: "sales" },
  { code: "KD-4", name: "Phòng Kinh doanh 4", type: "sales" },
  { code: "KD-5", name: "Phòng Kinh doanh 5", type: "sales" },
  { code: "KD-6", name: "Phòng Kinh doanh 6", type: "sales" },
  { code: "KD-7", name: "Phòng Kinh doanh 7", type: "sales" },
  { code: "KD-8", name: "Phòng Kinh doanh 8", type: "sales" },
  { code: "KD-9", name: "Phòng Kinh doanh 9", type: "sales" },
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
  // Module `system`, KHÔNG phải `*` (chốt 2026-08-24): lưới cấp quyền chỉ tra
  // module cụ thể, nên dòng `*` không hiện ra và cũng không tắt được bằng lưới.
  p("system", "configure-catalog", "company"),
  p("system", "configure-gift-rules", "company"),
];

/* Các bộ quyền vị trí đặc thù khác (đội tạo đơn, KDTH, KTTH…) cấp qua P-53/P-92
   khi tạo người thật — không seed tài khoản ảo kèm theo nữa (duyệt 03/08). */

export type SeedAccount = {
  username: string;
  fullName: string;
  title: string;
  role: RoleKey;
  /**
   * Mã nhân viên THẬT, lấy từ file HR (`scripts/data/staff-import.json`) — cùng
   * mã thì `db:import-staff` nhận ra người đã có và bỏ qua, không dựng hồ sơ thứ
   * hai chia đôi điểm KPI. Riêng `admin` không phải người nên giữ mã `TMP-ADMIN`.
   */
  staffCode: string;
  /** Số điện thoại thật, cùng nguồn với `staffCode`. */
  phone: string;
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
    staffCode: "225CONGDH",
    phone: "0933999010",
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
    staffCode: "170MINHDH",
    phone: "0939980090",
    fullName: "Đinh Hoàng Minh",
    title: "Cố vấn cao cấp",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["PHONG-KTTH", "PHONG-KDTH"],
    permissions: deputyDirectorPermissions,
  },
  {
    username: "pgd1",
    staffCode: "271LINHPH",
    phone: "0948897976",
    fullName: "Phan Hữu Linh",
    title: "Phó Giám Đốc 1",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["PHONG-DU-AN", "PHONG-BTXH"],
    permissions: deputyDirectorPermissions,
  },
  {
    username: "pgd2",
    staffCode: "006HUENTH",
    phone: "0989094139",
    fullName: "Nguyễn Thị Hồng Huệ",
    title: "Phó Giám Đốc 2",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["KD-2", "KD-6", "KD-7"],
    permissions: deputyDirectorPermissions,
  },
  {
    username: "pgd3",
    staffCode: "002HUYNHLH",
    phone: "0907769456",
    fullName: "Lư Hồng Huỳnh",
    title: "Phó Giám Đốc 3",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["KD-3", "KD-4", "KD-5", "KD-9"],
    permissions: deputyDirectorPermissions,
  },
  {
    username: "quyenpgd",
    staffCode: "009TRUONGDM",
    phone: "0865555416",
    fullName: "Dương Minh Trường",
    title: "Quyền Phó Giám Đốc",
    role: "deputy-director",
    departmentCode: null,
    manageScope: "listed",
    managedDepartmentCodes: ["KD-1", "KD-8"],
    permissions: deputyDirectorPermissions,
  },
  {
    // Tài khoản HỆ THỐNG, không phải người ảo — giao cho ai đảm nhiệm thì
    // đổi username/mật khẩu của chính tài khoản này.
    username: "admin",
    staffCode: "TMP-ADMIN",
    phone: "0900000000",
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
  { code: "LPB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "MSBa", requiredPhotos: 3, accountNumberMethod: "manual", coefficient: "1", countsAsApp: true },
  { code: "MSBb", requiredPhotos: 3, accountNumberMethod: "manual", coefficient: "1", countsAsApp: true },
  { code: "TCB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "BIDV", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "TPB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "VIB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  { code: "SHB", requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: "1", countsAsApp: true },
  // CNKD và HKD KHÔNG phải ngân hàng (chốt 2026-08-18) — chúng là LOẠI TÀI
  // KHOẢN của VPa, ghi ở cột `bank_accounts.account_type`. Dựng thành hai dòng
  // ở đây thì chúng hiện trong mọi ô chọn ngân hàng, và nhân viên mở được một
  // "tài khoản CNKD" tách rời khỏi VPa.
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
export const KPI_TARGET = { monthlyPoints: 100 };

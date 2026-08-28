import { z } from 'zod';

/**
 * Schema zod là NGUỒN SỰ THẬT DUY NHẤT cho kiểu dữ liệu.
 * Kiểu TypeScript suy ra từ đây, không khai báo song song.
 * Khi thiết kế database xong, sửa schema ở file này là cả FE đổi theo.
 */

/* ── Ngày ───────────────────────────────────────────────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hình dạng đúng CHƯA đủ: `2026-02-31` khớp regex mà không phải ngày có thật,
 * và Postgres từ chối nó bằng `22008`.
 *
 * ⚠️ Hàm này KHÔNG được ném lỗi. `zod` v4 chạy hết mọi check trên một chuỗi,
 * không dừng ở check đầu tiên hỏng — nên nhánh kiểm chạy cả trên chuỗi đã trượt
 * regex. Bản cũ gọi thẳng `new Date(v).toISOString()` và ném `RangeError` trên
 * `Invalid Date`; `safeParse` không bắt lỗi ném ra, route không có `try/catch`,
 * nên người dùng nhận 500 thay vì câu báo lỗi. Xoá trống ô ngày là chạm tới.
 */
export const isRealIsoDate = (v: string): boolean => {
  if (!ISO_DATE.test(v)) return false;
  const time = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(v);
};

/**
 * Ngày `YYYY-MM-DD` bắt buộc.
 *
 * Không kiểm định dạng thì Postgres tự đoán theo `DateStyle = ISO, MDY`:
 * `'05/08/2026'` ghi thành `2026-05-08`, tức lệch ngày mà không báo lỗi.
 */
export const isoDate = (emptyMessage: string) =>
  z.string().trim().min(1, emptyMessage).refine(isRealIsoDate, 'Ngày không hợp lệ');

/** Ngày `YYYY-MM-DD`, cho phép để trống. */
export const isoDateOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === '' || isRealIsoDate(v), 'Ngày không hợp lệ');

/* ── Phân quyền: ba trục (spec mục 1.1) ─────────────────────────────── */

/**
 * `customer` và `staff` là nghiệp vụ CƠ BẢN như `banking`/`insurance`/`services`
 * — có đúng bộ 6 hành động cơ bản, không phải "vô chủ" (customer) hay gộp lẫn
 * vào `system` (staff) như trước.
 */
export const ModuleKey = z.enum([
  'customer',
  'insurance',
  'banking',
  'services',
  'staff',
  /** P-91 · Sơ đồ tổ chức. Tách khỏi `staff`: sửa cơ cấu phòng không cùng
      việc với luân chuyển một con người. */
  'department',
  'system',
  '*',
]);
export type ModuleKey = z.infer<typeof ModuleKey>;

/**
 * Hai nhóm hành động:
 *
 * CƠ BẢN — 6 cái, cùng tên cùng nghĩa ở mọi module cơ bản (customer, banking,
 * insurance, services, staff). Module nào cũng dùng được cả 6, không cần đặt
 * tên riêng cho từng module.
 *
 * ĐẶC BIỆT — tên riêng, chỉ gắn với đúng module của nó, vì không diễn đạt nổi
 * bằng 6 cái cơ bản (vd "chốt & phát quà" không phải là "sửa" hay "tạo").
 */
export const Action = z.enum([
  // Cơ bản
  'view-summary',
  'view-detail',
  'create',
  'update',
  'delete',
  'export',
  // Đặc biệt — customer: XEM + SỬA CCCD đầy đủ, gộp một quyền (quyết định 03/08).
  // Không có quyền này thì mọi response chỉ thấy 4 số cuối và ô CCCD khoá.
  'access-id-number',
  // Đặc biệt — insurance
  'handle-fallback',
  /**
   * Đặt trạng thái đơn bảo hiểm sang BẤT KỲ giá trị nào, bỏ qua bảng bước
   * chuyển hợp lệ (migration 0050).
   *
   * Đây là công cụ gỡ đơn mắc, không phải một bước của vòng đời. Vòng đời có
   * chỗ đơn đi vào rồi không ra được — `pending-approval` từng như vậy — và
   * không phải chỗ nào cũng lường trước được.
   *
   * ⚠️ Đặt tay về `queued` là worker tạo lại đơn đó trên PVI lần hai. Người
   * được cấp quyền này phải biết điều đó.
   */
  'set-status',
  // Đặc biệt — banking
  'grant-gift',
  /**
   * Quản lý ngân hàng — gác CẢ hai màn: danh sách ngân hàng và kho mã giới
   * thiệu (chốt 2026-08-24, migration 0040).
   *
   * Tên cũ `manage-bank-catalog` chỉ nói tới danh mục, còn `manage-referral-codes`
   * đã gộp vào đây: kho mã thuộc về một ngân hàng, nên quản ngân hàng X mà
   * không sửa được mã của X là quản một nửa.
   *
   * Phạm vi ngân hàng đi bằng trục RIÊNG — `users.bank_scope` cộng bảng
   * `user_managed_banks`, không phải `Scope`.
   */
  'manage-bank',
  /**
   * Quản ĐÚNG những ngân hàng được giao, khác `manage-bank` là mọi ngân hàng.
   *
   * Danh sách ngân hàng nằm ở `User.managedBankIds`, gán ở hộp thoại sửa ngân
   * hàng. Người dùng KHÔNG có ô nào tự đổi phạm vi của chính mình.
   */
  'manage-assigned-banks',
  // Đặc biệt — insurance/services/system (danh mục dùng chung kiểu chọn-từ-danh-sách)
  'configure-catalog',
  // Đặc biệt — system
  'configure-gift-rules',
  /** Lập phòng, đổi tên, cho ngừng hoạt động. Tách khỏi CRUD của `staff`: sửa cơ
      cấu phòng ban không cùng việc với luân chuyển một con người. */
  'manage-org',
  'grant-permission',
  /** Cộng/trừ điểm KPI tay theo tháng, ghi từ hồ sơ nhân viên P-52. Không có
      trang riêng — quyền chỉ mở nút ghi trên màn đó. */
  'adjust-kpi',
]);
export type Action = z.infer<typeof Action>;

export const MODULE_LABEL: Record<ModuleKey, string> = {
  customer: 'Khách hàng',
  insurance: 'Bảo hiểm',
  banking: 'Ngân hàng',
  services: 'Dịch vụ',
  staff: 'Nhân viên',
  department: 'Phòng ban',
  system: 'Hệ thống',
  '*': 'Tất cả module',
};

export const ACTION_LABEL: Record<Action, string> = {
  'view-summary': 'Xem số liệu tổng hợp',
  'view-detail': 'Xem chi tiết',
  create: 'Thêm mới',
  update: 'Sửa',
  delete: 'Xoá / huỷ',
  export: 'Xuất dữ liệu',
  'access-id-number': 'Xem & sửa CCCD đầy đủ',
  'handle-fallback': 'Xử lý đơn lỗi (làm tay)',
  'set-status': 'Sửa trạng thái đơn bảo hiểm',
  'grant-gift': 'Chốt & phát quà',
  'manage-bank': 'Quản lý mọi ngân hàng & mã giới thiệu',
  'manage-assigned-banks': 'Quản lý ngân hàng được giao',
  'configure-catalog': 'Cấu hình danh mục',
  'configure-gift-rules': 'Cấu hình quy tắc quà',
  'manage-org': 'Sửa cơ cấu tổ chức & xem nhật ký truy vết',
  'grant-permission': 'Cấp quyền',
  'adjust-kpi': 'Cộng điểm KPI',
};

/** 6 hành động dùng chung cho mọi module cơ bản — xem mục 1.1.2 spec. */
export const BASE_ACTIONS: Action[] = ['view-summary', 'view-detail', 'create', 'update', 'delete', 'export'];

/**
 * Hành động ĐẶC BIỆT của từng module cơ bản, thêm sau 6 cái nền — module nào
 * không có dòng ở đây thì chỉ dùng đúng `BASE_ACTIONS`. `system` không có
 * hành động cơ bản nào cả (không phải nghiệp vụ có bản ghi để CRUD).
 */
/**
 * Hành động KHÔNG CHIA ĐƯỢC THEO PHẠM VI — có hoặc không, và có thì là toàn
 * công ty.
 *
 * `manage-org` gác NHẬT KÝ TRUY VẾT, và là nhánh tương thích cho những tài
 * khoản cấp trước module `department` (xem `canOrg`). Cấp nó ở mức `chỉ mình`
 * hay `phòng quản` là dựng ra một con số không có nghĩa — nhật ký không cắt
 * theo phòng được, nên người được cấp "hẹp" vẫn đọc trọn nhật ký công ty. Trông
 * như hẹp mà không hẹp là tệ hơn không hẹp.
 *
 * Ô chọn ở P-92 vì vậy chỉ có Bật/Tắt, và máy chủ nắn mọi phạm vi khác về
 * `company` trước khi ghi.
 */
export const SCOPELESS_ACTIONS: Action[] = ['manage-org', 'adjust-kpi', 'set-status'];

export const SPECIAL_ACTIONS_OF: Partial<Record<ModuleKey, Action[]>> = {
  customer: ['access-id-number'],
  insurance: ['handle-fallback', 'set-status'],
  banking: ['grant-gift'],
  /**
   * MỌI quyền cấu hình nằm ở `system` (chốt 2026-08-24).
   *
   * Trước đó chúng rải theo module nghiệp vụ: `insurance:configure-catalog` mở
   * danh mục quà, `banking:manage-bank-catalog` mở danh sách ngân hàng. Cách đó
   * đọc sai ý: bảy màn Cấu hình đều sửa dữ liệu DÙNG CHUNG toàn công ty, không
   * thuộc phòng nào và không thuộc module nghiệp vụ nào — người quản lý bảo
   * hiểm không vì thế mà nên sửa được gói bảo hiểm.
   *
   * Bốn hành động chứ không phải bảy: `configure-catalog` gác cùng lúc bốn màn
   * (danh mục quà & gói BH, chỉ tiêu KPI, loại dịch vụ, danh mục kênh) nên cấp
   * nó là mở cả bốn. Tách thành bảy là việc riêng, chưa làm.
   */
  system: [
    'configure-catalog',
    'configure-gift-rules',
    'manage-bank',
    'manage-assigned-banks',
    'manage-org',
    'grant-permission',
    'adjust-kpi',
  ],
};

/** Module cơ bản hiện trong màn cấp quyền lẻ (P-92/thẻ "Quyền") — không có `*`, quá rộng để cấp tay. */
export const EDITABLE_MODULES: ModuleKey[] = [
  'customer',
  'insurance',
  'banking',
  'services',
  'staff',
  'department',
  'system',
];

/**
 * Thứ tự từ hẹp đến rộng — dùng để so sánh, đừng đổi thứ tự.
 * Ba mức, khớp đúng sơ đồ tổ chức: không có chi nhánh, không có nhóm.
 */
export const SCOPES = ['own', 'managed', 'company'] as const;
export const Scope = z.enum(SCOPES);
export type Scope = z.infer<typeof Scope>;

/** Khớp đúng chữ với `ScopeSwitcher` — cùng một khái niệm phạm vi, đừng đặt tên khác nhau ở hai chỗ. */
export const SCOPE_LABEL: Record<Scope, string> = {
  own: 'Của tôi',
  managed: 'Phòng tôi quản',
  company: 'Toàn công ty',
};

export const Permission = z.object({
  module: ModuleKey,
  action: Action,
  scope: Scope,
});
export type Permission = z.infer<typeof Permission>;

/* ── Tổ chức: danh sách phòng phẳng ─────────────────────────────────── */

/**
 * Loại phòng — quyết định công thức tính điểm KPI (spec §7.0).
 *
 * Bản mirror của `departmentType` ở `server/db/schema.ts`. Thêm loại mới thì
 * sửa cả hai chỗ, cộng một migration đổi enum của Postgres.
 */
export const DepartmentType = z.enum(['sales', 'office']);
export type DepartmentType = z.infer<typeof DepartmentType>;

/**
 * Nhãn hiện ở P-91. Gọi thẳng theo công của phòng, không gọi theo tên loại
 * trong database — người lập phòng không cần biết chữ `sales`.
 */
export const DEPARTMENT_TYPE_LABEL: Record<DepartmentType, string> = {
  sales: 'Phòng kinh doanh',
  office: 'Văn phòng',
};

/** Câu giải thích dưới ô chọn loại phòng — nói rõ hệ quả về điểm KPI. */
export const DEPARTMENT_TYPE_HINT: Record<DepartmentType, string> = {
  sales: 'Nhân viên phòng này được tính điểm KPI theo combo ngân hàng và dịch vụ.',
  office: 'Phòng này chưa có công thức tính điểm — nhân viên không có điểm KPI.',
};

export const Department = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type Department = z.infer<typeof Department>;

/** Chức vụ — chỉ là bộ mặc định khi tạo tài khoản, không khoá cứng quyền. */
export const RoleKey = z.enum([
  'director',
  'deputy-director',
  'head',
  'deputy-head',
  'staff',
]);
export type RoleKey = z.infer<typeof RoleKey>;

/**
 * Sản phẩm bảo hiểm — NGUỒN SỰ THẬT là enum này, không phải nhãn tiếng Việt.
 *
 * Cùng giá trị với `insurance_product` trong DB. Giao diện từng so sánh bằng
 * chuỗi `'BH xe máy'` ở mười một chỗ; API thật trả `"motorbike"` nên cả mười
 * một lặng lẽ đi sai nhánh — bỏ kiểm biển số và loại xe, không hiện khối thông
 * tin xe, ô ngày sinh hiện lại trên đơn xe máy, bot PVI nhận sai bộ field
 * (`mgst-db-design.md` §2).
 *
 * Nhãn tiếng Việt CHỈ để hiển thị, tra qua `PRODUCT_LABEL`. Đừng đem đi so.
 */
export const InsuranceProduct = z.enum(['motorbike', 'electric-accident']);
export type InsuranceProduct = z.infer<typeof InsuranceProduct>;

export const PRODUCT_LABEL: Record<InsuranceProduct, string> = {
  motorbike: 'BH xe máy',
  'electric-accident': 'BH tai nạn điện',
};

export const ROLE_LABEL: Record<RoleKey, string> = {
  director: 'Giám đốc',
  'deputy-director': 'Phó giám đốc',
  head: 'Trưởng phòng',
  'deputy-head': 'Phó phòng',
  staff: 'Nhân viên',
};

/**
 * Bậc chức vụ — SỐ CÀNG CAO CHỨC VỤ CÀNG CAO.
 *
 * Nguồn duy nhất. Hai việc dùng nó: chặn người bậc thấp thao tác lên người bậc
 * cao hơn (`permissions.ts`), và sắp cột Chức vụ ở các bảng.
 *
 * ⚠️ ĐỪNG sắp bảng bằng chính cột `role`. Enum trong database khai theo thứ tự
 * `director` → `staff`, nên `director` mang số NHỎ nhất và `ORDER BY role DESC`
 * đẩy Nhân viên lên đầu — mũi tên trên tiêu đề cột nói ngược với thứ tự thấy
 * được. Sửa 2026-08-14; câu SQL tương ứng là `roleRankExpr` ở `server/people.ts`.
 */
export const ROLE_RANK: Record<RoleKey, number> = {
  director: 4,
  'deputy-director': 3,
  head: 2,
  'deputy-head': 1,
  staff: 0,
};

/**
 * Chức danh gợi ý sẵn cho mỗi chức vụ khi TẠO người mới.
 *
 * Khác `ROLE_LABEL`: đây là chữ in trên danh thiếp, người dùng sửa được thành
 * "Phó Giám Đốc 2" hay "Cố vấn cao cấp". `ROLE_LABEL` là tên của vai trong hệ
 * thống, không đổi. Riêng vai Nhân viên thì chức danh thật là "Nhân viên kinh
 * doanh" — đội ngoài hiện trường tự gọi mình như vậy.
 */
export const ROLE_TITLE: Record<RoleKey, string> = {
  director: 'Giám đốc',
  'deputy-director': 'Phó Giám Đốc',
  head: 'Trưởng phòng',
  'deputy-head': 'Phó phòng',
  staff: 'Nhân viên kinh doanh',
};

/**
 * Người này quản những phòng nào.
 *
 * `company` KHÔNG liệt kê từng phòng — mở phòng mới mà quên thêm vào danh sách
 * thì giám đốc mù một phòng và hệ thống không báo gì.
 */
export const ManageScope = z.enum(['none', 'listed', 'company']);
export type ManageScope = z.infer<typeof ManageScope>;


/* ── Người dùng ─────────────────────────────────────────────────────── */

export const User = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  role: RoleKey,
  /** THUỘC VỀ — đúng một phòng. NULL với Giám đốc, Cố vấn và các Phó GĐ. */
  departmentId: z.string().nullable(),
  /** QUẢN LÝ — 0..n phòng. Chỉ có giá trị khi manageScope = 'listed'. */
  managedDepartmentIds: z.array(z.string()),
  manageScope: ManageScope,
  /**
   * Ngân hàng người này được giao quản — chỉ có nghĩa với người mang
   * `system:manage-assigned-banks`.
   *
   * Gán ở hộp thoại sửa ngân hàng, không ở hồ sơ nhân viên.
   */
  managedBankIds: z.array(z.string()),
  /** Tên chức danh hiển thị, ví dụ "Phó GĐ 2" — khác với `role`. */
  title: z.string(),
  permissions: z.array(Permission),
  active: z.boolean(),
});
export type User = z.infer<typeof User>;

/* ── Đăng nhập ──────────────────────────────────────────────────────── */

export const LoginForm = z.object({
  username: z.string().min(1, 'Chưa nhập tên đăng nhập'),
  password: z.string().min(1, 'Chưa nhập mật khẩu'),
  /**
   * Không tích: phiên 1 tháng. Có tích: 1 năm.
   * Cố ý KHÔNG dùng .default() — zod v4 làm kiểu vào/ra lệch nhau và
   * react-hook-form sẽ báo lỗi kiểu. Giá trị mặc định đặt ở defaultValues.
   */
  remember: z.boolean(),
});
export type LoginForm = z.infer<typeof LoginForm>;

export const LoginResult = z.object({
  user: User,
  expiresAt: z.string(),
});
export type LoginResult = z.infer<typeof LoginResult>;

/** Sai 5 lần liên tiếp → khoá 15 phút, quản trị hệ thống mở lại. */
export const LOGIN_ERROR = {
  BAD_CREDENTIALS: 'bad-credentials',
  LOCKED: 'locked',
} as const;

export const LoginError = z.object({
  code: z.enum([LOGIN_ERROR.BAD_CREDENTIALS, LOGIN_ERROR.LOCKED]),
  message: z.string(),
  attemptsLeft: z.number().optional(),
  lockedUntil: z.string().optional(),
});
export type LoginError = z.infer<typeof LoginError>;

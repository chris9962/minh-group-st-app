import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema Postgres — bám ../../../mgst-db-design.md (32 bảng · 16 enum).
 *
 * Không còn mock nên id là uuid chuẩn design doc — hết giai đoạn text id.
 * Cột sinh `customers.search_name` cần hàm `mgst_normalize` + extension
 * unaccent/pg_trgm: tạo ở ĐẦU file migration 0000 (SQL viết tay chèn trước
 * phần drizzle sinh), vì drizzle-kit không quản extension/function.
 */

/* ── 16 enum (mgst-db-design.md §0) ─────────────────────────────────── */

export const moduleKey = pgEnum("module_key", [
  "customer", "insurance", "banking", "services", "staff",
  // P-91 · sơ đồ tổ chức, thêm ở migration 0026
  "department",
  "system", "*",
]);

export const actionKey = pgEnum("action_key", [
  "view-summary", "view-detail", "create", "update", "delete", "export",
  "handle-fallback", "grant-gift",
  /**
   * Gộp từ `manage-bank-catalog` và `manage-referral-codes` (migration 0040).
   *
   * ⚠️ `manage-referral-codes` VẪN nằm trong enum ở database — Postgres không
   * bỏ được một giá trị enum, và `audit_log` còn giữ lịch sử những lượt cấp
   * quyền mang tên đó. Bỏ khỏi danh sách này nghĩa là không cấp mới được, không
   * phải là nó đã biến mất.
   */
  "manage-bank",
  /**
   * Quản ĐÚNG những ngân hàng có tên người đó trong `user_managed_banks`
   * (migration 0042). Khác `manage-bank` — cái đó là mọi ngân hàng.
   *
   * Hai vai là hai QUYỀN, không phải một quyền với hai phạm vi: phạm vi đọc từ
   * quyền thì nó đi qua trần `checkPermissions` của lưới cấp quyền, còn một cột
   * riêng thì phải nhớ thêm luật vào `checkCeilings` — và lần đầu đã quên.
   */
  "manage-assigned-banks",
  "configure-catalog", "configure-gift-rules",
  "manage-org", "grant-permission",
  // đặc biệt · customer: XEM + SỬA CCCD đầy đủ, gộp một quyền (quyết định 03/08)
  "access-id-number",
  // đặc biệt · system: cộng/trừ điểm KPI tay theo tháng (migration 0046)
  "adjust-kpi",
  // đặc biệt · insurance: đặt trạng thái đơn tuỳ ý, bỏ qua bảng bước chuyển
  // hợp lệ (migration 0050). Công cụ gỡ đơn mắc.
  "set-status",
  // đặc biệt · system: đọc và đánh dấu đã xử lý góp ý ở P-96 (migration 0052)
  "handle-feedback",
]);

export const scopeKey = pgEnum("scope_key", ["own", "managed", "company"]);
export const roleKey = pgEnum("role_key", [
  "director", "deputy-director", "head", "deputy-head", "staff",
]);
export const manageScope = pgEnum("manage_scope", ["none", "listed", "company"]);


/**
 * Loại phòng — quyết định công thức tính điểm KPI (spec §7.0, chốt 2026-08-22).
 *
 * `sales` là chín phòng Kinh doanh 1–9: công thức combo ngân hàng cộng hệ số
 * loại dịch vụ (spec §7.1 · §7.2) chỉ mô tả đúng công của họ.
 * `office` là phần còn lại — CHƯA CÓ công thức nào, không phải "có công thức và
 * ra 0 điểm".
 */
export const departmentType = pgEnum("department_type", ["sales", "office"]);

export const accountNumberMethod = pgEnum("account_number_method", ["phone-match", "manual"]);
export const bankAccountType = pgEnum("bank_account_type", ["none", "CNKD", "HKD"]);
export const bankAccountStatus = pgEnum("bank_account_status", ["creating", "done", "error"]);

export const insuranceProduct = pgEnum("insurance_product", ["motorbike", "electric-accident"]);
export const insuranceOrderStatus = pgEnum("insurance_order_status", [
  "queued", "creating", "pending-approval", "manual-queued", "manual-progress",
  // Duyệt xong bên PVI, còn đợi PVI sinh file giấy chứng nhận. Việc còn lại
  // không phải thao tác trên PVI nữa — xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`.
  "awaiting-certificate",
  "done",
  // Trạng thái CUỐI thứ hai, cạnh 'done'. Không nằm trong vòng đời tự động:
  // chỉ `cancelInsuranceOrder` đưa đơn vào đây, và lượt đó bắt ghi lý do.
  "cancelled",
]);
export const insuranceOrderSource = pgEnum("insurance_order_source", ["self", "gift"]);

export const channelInputKind = pgEnum("channel_input_kind", [
  "ward-hamlet", "hospital", "free-text", "none",
]);
/* ❌ gift_group · gift_rule_mode · app_count_comparator: BỎ (03/08) — chỉ phục
   vụ hai bảng cấu hình quy tắc quà, nay quy tắc nằm ở code theo kỳ. */

/** Ảnh mở tài khoản đếm theo `banks.required_photos`; ảnh giao dịch thì không. */
export const photoKind = pgEnum("photo_kind", ["opening", "transaction"]);

export const notificationKind = pgEnum("notification_kind", [
  "order-done", "order-manual", "code-low",
]);

/** P-96 · Góp ý đã xử lý hay chưa. Hai trạng thái, thêm ở migration 0052. */
export const feedbackStatus = pgEnum("feedback_status", ["pending", "done"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true });

/* ── §1 · Tổ chức & tài khoản ───────────────────────────────────────── */

export const departments = pgTable("departments", {
  id: id(),
  /** Mã cố định cho module luật theo kỳ trỏ vào (`PHONG-Y`) — P-91 cho đổi TÊN phòng. */
  code: text("code").notNull().unique(),
  name: text("name").notNull().unique(),
  /**
   * Mặc định `office`: phòng lập ở P-91 chưa có ô chọn loại, mà cấp nhầm công
   * thức tính điểm cho một phòng không kinh doanh thì không ai thấy — còn phòng
   * kinh doanh mới bị chấm 0 thì nhân viên báo ngay.
   */
  type: departmentType("type").notNull().default("office"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    username: text("username").notNull().unique(),
    /** Mã nhân viên — định danh ở app khác của công ty; nhập tay lúc tạo (P-53). */
    staffCode: text("staff_code"),
    /** Băm một chiều (bcrypt) — không có đường đọc lại (C-02). */
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    /** Chức vụ = bộ quyền mặc định lúc tạo, KHÔNG phải nguồn quyền. */
    role: roleKey("role").notNull(),
    title: text("title").notNull(),
    /** THUỘC VỀ đúng một phòng; null với Ban giám đốc. */
    departmentId: uuid("department_id").references(() => departments.id),
    manageScope: manageScope("manage_scope").notNull().default("none"),
    active: boolean("active").notNull().default(true),
    /** C-01: sai 5 lần liên tiếp → khoá 15 phút, quản trị mở lại. */
    failedAttempts: smallint("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("users_department").on(t.departmentId),
    uniqueIndex("users_staff_code").on(t.staffCode).where(sql`staff_code is not null`),
  ],
);

/** QUẢN LÝ đi đường riêng (#43) — chỉ có dòng khi manage_scope = 'listed'. */
export const userManagedDepartments = pgTable(
  "user_managed_departments",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    departmentId: uuid("department_id").notNull().references(() => departments.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] })],
);

/**
 * Ngân hàng nào do ai quản — chỉ có nghĩa với người mang
 * `system:manage-assigned-banks`.
 *
 * Nhiều-nhiều CẢ HAI CHIỀU. Một người quản nhiều ngân hàng, và một ngân hàng có
 * nhiều người quản; khoá chính hai cột cho sẵn điều đó. KHÔNG thêm ràng buộc
 * duy nhất trên `bankId` — đó đúng là thứ chặn người quản thứ hai.
 *
 * Gán ở hộp thoại sửa ngân hàng, không ở hồ sơ nhân viên: câu hỏi người dùng
 * đang hỏi lúc đó là "ngân hàng này ai quản", không phải "người này quản gì".
 */
export const userManagedBanks = pgTable(
  "user_managed_banks",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    bankId: uuid("bank_id").notNull().references(() => banks.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bankId] })],
);

/** Nguồn quyền THẬT (spec §1.1) — không suy ngược từ role khi kiểm quyền. */
export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    module: moduleKey("module").notNull(),
    action: actionKey("action").notNull(),
    scope: scopeKey("scope").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.module, t.action] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    /** Lưu băm sha256, không lưu token trần. */
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    remember: boolean("remember").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash").on(t.tokenHash),
    // `resetPassword` xoá theo user_id, và dọn phiên hết hạn lọc theo expires_at.
    index("sessions_user").on(t.userId),
    index("sessions_expires").on(t.expiresAt),
  ],
);

/* ── §2 · Danh mục ──────────────────────────────────────────────────── */

export const banks = pgTable(
  "banks",
  {
    id: id(),
    /** VPa/VPb, MSBa/MSBb là các ngân hàng RIÊNG — không gộp cha–con (spec §2.6). */
    code: text("code").notNull().unique(),
    active: boolean("active").notNull().default(true),
    requiredPhotos: smallint("required_photos").notNull().default(3),
    accountNumberMethod: accountNumberMethod("account_number_method")
      .notNull()
      .default("phone-match"),
    /**
     * Tiền tố điền sẵn vào ô số tài khoản ở bước 2 khi phương thức là `manual`
     * — vài ngân hàng luôn mở đầu số tài khoản bằng một cụm cố định (`1000`,
     * `0000`). `''` = không có tiền tố.
     */
    accountNumberPrefix: text("account_number_prefix").notNull().default(""),
    /**
     * Độ dài số tài khoản khi phương thức là `manual` — TỔNG số chữ số, tính cả
     * tiền tố. null = ngân hàng không cố định độ dài, không kiểm.
     */
    accountNumberLength: smallint("account_number_length"),
    /** Hệ số điểm KPI — VPb = 1.4. */
    coefficient: numeric("coefficient", { precision: 4, scale: 2 }).notNull().default("1"),
    /** false với CNKD/HKD — tính điểm nhưng không đếm vào tổng app xét quà. */
    countsAsApp: boolean("counts_as_app").notNull().default(true),
    /**
     * Thứ tự trong ô chọn ngân hàng lúc mở tài khoản — số LỚN lên đầu.
     *
     * Ngân hàng đang đẩy mạnh đặt số cao thì Kinh doanh chọn được ngay, không
     * phải dò trong danh sách 13 mã. Bằng nhau thì mã ngân hàng quyết định thứ
     * tự, xem `listBanks`.
     */
    priority: smallint("priority").notNull().default(0),
    /** null = ngân hàng không giới hạn tuổi mở tài khoản. */
    minAge: smallint("min_age"),
    /** null = ngân hàng không giới hạn tuổi mở tài khoản. */
    maxAge: smallint("max_age"),
    /**
     * Hướng dẫn mở tài khoản của riêng ngân hàng này (migration 0043).
     *
     * Chữ tự do nhiều dòng — người nhập tự đánh số bước và tự ghi chú ảnh
     * ("Ảnh 1: lúc nhập mã"). KHÔNG tách thành bảng bước riêng: nội dung mỗi
     * ngân hàng một khác, và mọi cấu trúc dựng ra đều chật với ngân hàng sau.
     */
    guide: text("guide"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Số âm hay 0 làm chốt chặn ảnh mất tác dụng: tài khoản lên "Hoàn thành" mà
  // không có tấm ảnh nào, và mã giới thiệu thì đã bị tiêu vĩnh viễn.
  (t) => [
    check("banks_required_photos_non_negative", sql`${t.requiredPhotos} >= 0`),
    check("banks_min_age_non_negative", sql`${t.minAge} is null or ${t.minAge} >= 0`),
    check("banks_max_age_non_negative", sql`${t.maxAge} is null or ${t.maxAge} >= 0`),
    check("banks_age_range_valid", sql`${t.minAge} is null or ${t.maxAge} is null or ${t.minAge} <= ${t.maxAge}`),
  ],
);

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: id(),
    bankId: uuid("bank_id").notNull().references(() => banks.id),
    /** Tên nhân viên dùng để nhận biết một mã hoặc QR trong danh sách. */
    displayName: text("display_name").notNull(),
    /** Mã text do ngân hàng cấp; QR-only thì để null. */
    code: text("code"),
    total: integer("total").notNull(),
    /** Số đã dùng TRƯỚC khi nhập vào hệ thống (P-62) — không có dòng `bank_accounts` nào để đếm. */
    importedUsed: integer("imported_used").notNull().default(0),
    /**
     * Số tài khoản `done` và số tài khoản `creating` đang giữ chỗ mã này —
     * LƯU SẴN, ngoại lệ có chủ đích của luật §9 "used/holding thì đếm sống"
     * (`mgst-db-design.md` §9, mục đã ghi lại ngoại lệ này).
     *
     * ⚠️ KHÔNG code nào được tự cộng trừ hai cột này. Trigger
     * `mgst_sync_referral_counts` giữ chúng, nên mọi đường ghi đều đúng: mở tài
     * khoản, hoàn thành, xoá bản nháp, đổi mã, nhập hàng loạt, vá tay.
     *
     * Vì sao lưu — hai lý do, cả hai đều không né được bằng index:
     *
     * 1. P-61 lọc theo TRẠNG THÁI và sắp theo TIẾN ĐỘ, mà cả hai đều suy từ
     *    `used`. Đếm sống thì phải gộp TOÀN BỘ `bank_accounts` xong mới biết
     *    dòng nào khớp bộ lọc — không cắt trang trước được, và câu đếm tổng
     *    chạy lại y nguyên phép gộp đó lần thứ hai.
     * 2. §10 đòi chốt "còn chỗ" phải khoá dòng `referral_codes` bằng
     *    `select … for update` TRONG giao dịch tạo tài khoản. Với công thức
     *    đếm sống thì mỗi lần kiểm là chạy phép gộp toàn bảng trong lúc đang
     *    giữ khoá; đọc hai cột này thì chỉ còn một dòng.
     *
     * `used` hiển thị = `imported_used + used_count`. Đừng gộp `imported_used`
     * vào cột đếm: lần `db:recount` đầu tiên sẽ đè mất số nhập tay từ P-62.
     *
     * Lệch thì `bun run db:recount` đếm lại toàn bộ.
     */
    usedCount: integer("used_count").notNull().default(0),
    holdingCount: integer("holding_count").notNull().default(0),
    /**
     * Link mở tài khoản của ngân hàng, giải ra từ ảnh QR ở P-61 (spec §4.4b).
     * `null` = ngân hàng không phát link, hoặc mã nhập trước migration 0027.
     */
    openUrl: text("open_url"),
    /**
     * KHOÁ của ảnh QR trong kho ảnh (`server/storage.ts`), không phải URL.
     * `null` = mã chưa có ảnh, gồm mọi mã lập trước migration 0039.
     *
     * Lưu cả ảnh chứ không chỉ chuỗi giải ra: bước 2 của P-20 đưa ảnh cho khách
     * quét bằng điện thoại của họ, mà `open_url` chỉ mở được app trên máy đang
     * mở màn hình.
     */
    qrImage: text("qr_image"),
    /**
     * Thứ tự trong ô chọn mã lúc mở tài khoản — số LỚN lên đầu, cùng luật với
     * `banks.priority`. Ngân hàng sắp trước, mã sắp trong từng ngân hàng.
     *
     * Ô chọn chỉ hiện mã còn chỗ, nên số này KHÔNG kéo mã đã đầy trở lại.
     */
    priority: smallint("priority").notNull().default(0),
    /** Loại tài khoản mà ngân hàng cấp mã này. Chốt trước khi giữ chỗ mã. */
    accountType: bankAccountType("account_type").notNull().default("none"),
    /**
     * `all` = mọi phòng dùng được; `departments` = chỉ những phòng có dòng
     * trong `referral_code_departments` (spec §4.4d).
     *
     * Ý định nằm ở cột này chứ không suy từ số dòng bảng nối: "cho tất cả" và
     * "chưa chọn phòng nào" đều cho bảng nối rỗng nhưng là hai ý trái ngược.
     */
    scope: text("scope").notNull().default("all"),
    /**
     * Tên tỉnh của mã, chọn từ 34 tỉnh tham chiếu; `''` = chưa gán. Lưu TÊN
     * chứ không lưu id — cùng lối `channelDetail` của tài khoản: chuỗi hiện
     * cho nhân viên đọc ở bước 2, không có phép nối nào cần id.
     */
    province: text("province").notNull().default(""),
    /** Chi nhánh ngân hàng hỗ trợ mã này, người dùng gõ tay; `''` = chưa gán. */
    supportBranch: text("support_branch").notNull().default(""),
    /**
     * Tắt là mã rời ô chọn và bị `startBankAccount` từ chối, kể cả khi còn
     * chỗ. Trước migration 0047 mã chỉ dừng khi tiêu hết `total`.
     */
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("referral_codes_bank_code").on(t.bankId, t.code),
    uniqueIndex("referral_codes_bank_display_name").on(t.bankId, t.displayName),
    check(
      "referral_codes_text_or_qr",
      sql`nullif(btrim(${t.code}), '') is not null or ${t.qrImage} is not null`,
    ),
    check("referral_codes_total_positive", sql`total > 0`),
    // Số đếm âm là trigger sai. Vỡ ra ở đây còn hơn để nó âm thầm làm màn P-61
    // hiện "còn -3 chỗ" và chốt "còn chỗ" mở cửa cho mã đã đầy.
    check(
      "referral_codes_counts_non_negative",
      sql`used_count >= 0 and holding_count >= 0`,
    ),
  ],
);

/**
 * Phòng nào dùng được mã nào — chỉ có nghĩa khi `referral_codes.scope` là
 * `departments` (spec §4.4d).
 *
 * Đổi phạm vi KHÔNG đụng tài khoản đã mở: phạm vi là cấu hình nhất thời, sáng
 * cho phòng 1 chạy mã này thì chiều đổi sang phòng 2 được, mà lịch sử phải giữ
 * nguyên.
 */
export const referralCodeDepartments = pgTable(
  "referral_code_departments",
  {
    referralCodeId: uuid("referral_code_id")
      .notNull()
      .references(() => referralCodes.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull().references(() => departments.id),
  },
  (t) => [
    primaryKey({ columns: [t.referralCodeId, t.departmentId] }),
    // Câu lọc đi từ MỘT phòng ra danh sách mã; khoá chính lo chiều ngược lại.
    index("referral_code_departments_department").on(t.departmentId),
  ],
);

export const channels = pgTable("channels", {
  id: id(),
  /** Mã cố định cho module luật (`KENH-BENH-VIEN`). */
  code: text("code").notNull().unique(),
  name: text("name").notNull().unique(),
  /** Là DỮ LIỆU, không phải nhánh code theo tên kênh (spec §2.3). */
  inputKind: channelInputKind("input_kind").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const hospitals = pgTable("hospitals", {
  id: id(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const serviceTypes = pgTable("service_types", {
  id: id(),
  name: text("name").notNull().unique(),
  /** Hệ số điểm KPI theo loại dịch vụ (P-84). */
  coefficient: numeric("coefficient", { precision: 4, scale: 2 }).notNull().default("1"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const giftItems = pgTable("gift_items", {
  id: id(),
  /** Mã cố định cho module luật (`QUA-NON-BH`) — file luật đóng băng không trỏ theo tên. */
  code: text("code").notNull().unique(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const insurancePackages = pgTable(
  "insurance_packages",
  {
    id: id(),
    /** Mã cố định cho module luật (`BH-1N-XEMAY`). */
    code: text("code").notNull().unique(),
    /**
     * CHỈ để hiển thị. Không code nào được đọc chuỗi này để suy ra sản phẩm, số
     * năm hay số đơn — cấu trúc gói nằm ở `insurance_package_legs`.
     */
    name: text("name").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

/**
 * Gói gồm những gì (chốt 04/08) — MỘT LEG = MỘT ĐƠN bảo hiểm.
 *
 * Màn tạo đơn cứ theo danh sách leg mà hiện đúng số form, mỗi form một bộ ô đầy
 * đủ. Gói "2 năm tai nạn điện" và gói ghép giờ chỉ khác nhau ở `product` của
 * từng leg — không còn cấu hình nào phân biệt hai ca đó.
 *
 * ⚠️ Trước 04/08 hệ thống suy ngược cấu trúc từ chuỗi `name` bằng bốn bộ luật
 * parse: `includes('xe máy')` ra sản phẩm, `/(\d+)\s*năm/` ra số năm,
 * `split('+')` ra số đơn, `/(\d+k)/` ra phí. Mà `name` là thứ CEO sửa được ở
 * P-82 — đặt tên "BH xe máy 3N" là regex trượt, âm thầm trả 1 năm, và một hợp
 * đồng 3 năm bị ghi ngày kết thúc sai 2 năm. Nay khai tường minh ở đây.
 *
 * Cố ý KHÔNG có cột quan hệ giữa các leg: không `shared_beneficiary` (gói nhiều
 * leg luôn hiện N form độc lập), không cờ nối ngày (mỗi form mặc định hôm nay →
 * hôm nay + `years`, KD tự sửa nếu muốn nối tiếp).
 */
export const insurancePackageLegs = pgTable(
  "insurance_package_legs",
  {
    id: id(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => insurancePackages.id, { onDelete: "cascade" }),
    /** Thứ tự các form trên màn tạo đơn, từ 1. */
    ord: smallint("ord").notNull(),
    product: insuranceProduct("product").notNull(),
    years: smallint("years").notNull(),
    /** Phí của ĐƠN mà leg này sinh ra, TRỌN THỜI HẠN — khớp `insurance_orders.fee`. */
    fee: integer("fee").notNull().default(0),
  },
  (t) => [
    uniqueIndex("insurance_package_legs_ord").on(t.packageId, t.ord),
    check("insurance_package_legs_years_positive", sql`${t.years} > 0`),
    // Phí âm ở danh mục sẽ trôi xuống `insurance_orders.fee` rồi mới đụng ràng
    // buộc `fee >= 0` — lỗi nổ ở màn tạo đơn trong khi dữ liệu sai nằm ở P-82.
    check("insurance_package_legs_fee_non_negative", sql`${t.fee} >= 0`),
  ],
);

/* Tỉnh/Xã hai tầng (spec §2.4): tham chiếu chỉ đọc + đang dùng của công ty. */

export const refProvinces = pgTable("ref_provinces", {
  /** Mã gốc từ address-kit — khoá tự nhiên, không sinh uuid. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const refWards = pgTable(
  "ref_wards",
  {
    id: text("id").primaryKey(),
    provinceId: text("province_id").notNull().references(() => refProvinces.id),
    name: text("name").notNull(),
  },
  (t) => [index("ref_wards_province").on(t.provinceId)],
);

export const provinces = pgTable("provinces", {
  id: id(),
  refId: text("ref_id").notNull().unique().references(() => refProvinces.id),
  /** Chép từ tham chiếu lúc thêm — đổi tên hành chính sau đó không tự lan. */
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const wards = pgTable(
  "wards",
  {
    id: id(),
    provinceId: uuid("province_id").notNull().references(() => provinces.id),
    refId: text("ref_id").notNull().unique().references(() => refWards.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  // Ô chọn tỉnh → xã lọc theo province_id mỗi lần mở form khách hàng / mở TK.
  (t) => [index("wards_province").on(t.provinceId)],
);

export const hamlets = pgTable(
  "hamlets",
  {
    id: id(),
    wardId: uuid("ward_id").notNull().references(() => wards.id),
    /** Ấp KHÔNG có nguồn tham chiếu — luôn nhập tay. */
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Ấp nhập tay nên bảng phình theo thời gian; ô chọn lọc theo ward_id.
    index("hamlets_ward").on(t.wardId),
    /**
     * Một xã không được có hai ấp trùng tên.
     *
     * Không chặn thì bấm "Thêm ấp" hai lần (mạng chậm, hoặc hai người cùng
     * nhập) ra hai dòng khác id cùng tên: ô chọn hiện "Ấp 3" hai lần không phân
     * biệt nổi, và khách của cùng một ấp bị gắn vào hai mã khác nhau nên gom
     * theo ấp ra hai nhóm. Trùng tên GIỮA hai xã thì vẫn được — "Ấp 3" là tên
     * phổ biến, xã nào cũng có.
     */
    uniqueIndex("hamlets_ward_name").on(t.wardId, t.name),
  ],
);

/* ── §3 · Khách hàng ────────────────────────────────────────────────── */

export const customers = pgTable(
  "customers",
  {
    id: id(),
    fullName: text("full_name").notNull(),
    /** Cột chuẩn hoá cho C-06 — sinh bằng mgst_normalize (đ/Đ → d/D), index trigram. */
    searchName: text("search_name").generatedAlwaysAs(sql`mgst_normalize(full_name)`),
    dob: date("dob"),
    /** CCCD — trường bảo mật: API mặc định chỉ trả 4 số cuối (quyết định 03/08). */
    idNumber: text("id_number"),
    address: text("address").notNull().default(""),
    /** Kênh thuộc về KHÁCH, nhập đúng một lần (spec §2.3). */
    channelId: uuid("channel_id").references(() => channels.id),
    channelDetail: text("channel_detail").notNull().default(""),
    /**
     * Số tài khoản `done` và số đơn bảo hiểm của khách — LƯU SẴN, ngoại lệ có
     * chủ đích của luật "tính ra được thì không lưu" (db-design §9).
     *
     * ⚠️ KHÔNG code nào được tự cộng trừ hai cột này. Trigger
     * `mgst_sync_account_count` / `mgst_sync_insurance_count` giữ chúng, nên mọi
     * đường ghi đều đúng: màn nghiệp vụ, nhập hàng loạt, script vá tay.
     * Tự cộng ở tầng app là mở đường cho một chỗ quên rồi số lệch lặng lẽ.
     *
     * Vì sao lưu: P-40 cho sắp theo hai cột này, mà sắp theo số đếm thì buộc
     * phải đếm CẢ KHO trước khi cắt trang — không cắt trước được, vì chưa đếm
     * thì chưa biết 15 người đứng đầu là ai. Đo ở 250.000 khách: đếm sống
     * 0,8–1,0 giây mỗi lần bấm, đọc cột lưu sẵn 1 mili giây.
     *
     * Lệch thì `bun run db:recount` đếm lại toàn bộ.
     */
    accountCount: integer("account_count").notNull().default(0),
    insuranceCount: integer("insurance_count").notNull().default(0),
    /**
     * Trường hợp quà khách đang khớp (`TH1`…`TH6`), `null` = chưa đủ điều kiện.
     *
     * LƯU SẴN, và là ngoại lệ KHÁC HẲN hai cột đếm bên trên: trigger ở database
     * không giữ nổi cột này, vì giá trị của nó do một hàm JavaScript quyết định
     * (`src/rules/`), và thể lệ đổi hình dạng theo kỳ nên không viết lại được
     * bằng SQL.
     *
     * Vì sao vẫn phải lưu: P-40 cho LỌC theo trạng thái quà và P-80 đếm "đủ ĐK
     * chưa phát". Chạy hàm luật cho từng khách nghĩa là kéo tài khoản của CẢ
     * KHO về tầng ứng dụng mỗi lần mở màn — đúng thứ AGENTS.md §5.2 cấm.
     *
     * ⚠️ Giá trị chỉ phụ thuộc TÀI KHOẢN `done` của khách, không phụ thuộc kênh
     * hay phòng: hai thứ đó chỉ đổi món trong rổ, không đổi trường hợp. Nên chỗ
     * duy nhất phải ghi lại là đường tài khoản lên/rời `done`, và
     * `recomputeGiftCase` (`server/gift.ts`) lo việc đó.
     *
     * Lệch thì `bun run db:recount` tính lại toàn bộ.
     */
    /**
     * DANH SÁCH MÃ QUÀ khách đang được nhận — rỗng nghĩa là chưa có gì để phát.
     *
     * LƯU SẴN, ngoại lệ của luật "tính ra được thì không lưu" (db-design §9),
     * cùng lý do với hai cột đếm bên trên: P-40 lọc theo trạng thái quà và P-80
     * đếm khách chờ phát. Chạy hàm luật cho từng dòng nghĩa là kéo tài khoản của
     * cả kho về tầng ứng dụng (AGENTS.md §5.2).
     *
     * ⚠️ Trigger ở database KHÔNG giữ nổi cột này: giá trị của nó do một hàm
     * JavaScript quyết định (`src/rules/`), và thể lệ đổi hình dạng theo kỳ.
     * `recomputeGiftCase` (`server/gift.ts`) lo việc ghi.
     *
     * Cột này thay `gift_case` cũ (mã bậc `TH1`…`TH6`). Mã bậc trả lời sai ca
     * khách chưa đủ tổ hợp ngân hàng nhưng có món thêm: bậc `null` mà rổ có món.
     *
     * Phụ thuộc BA nguồn, khác `gift_case` cũ chỉ phụ thuộc tài khoản: tài khoản
     * `done` của khách · kênh của khách · phòng của người lập hồ sơ. Đổi một
     * trong ba thì phải gọi lại `recomputeGiftCase`.
     *
     * Lệch thì `bun run db:recount` tính lại toàn bộ.
     */
    giftBasket: text("gift_basket").array().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id),
    /**
     * Phòng của người lập hồ sơ. `writeStaff` viết lại cột này cho mọi khách của
     * họ khi họ chuyển phòng — dữ liệu đi theo người (chốt 13/08).
     *
     * Khách không phải bản ghi nghiệp vụ, nhưng vẫn cần cột này vì thể lệ kỳ
     * 2026-08 (mục 4 lưu ý 2) cho Phòng Y quy đổi quà TH5/TH6, và "phòng của
     * khách" đọc theo phòng người lập hồ sơ. Giữ cột thay vì nối `users` lúc
     * truy vấn: nối thì mất chỉ mục và phải nối trước khi cắt trang
     * (AGENTS.md §5.2).
     *
     * ⚠️ Chuyển phòng ĐỔI RỔ QUÀ của khách chưa phát: `updateStaff` gọi
     * `recomputeGiftCase` cho từng khách ngay sau lượt chuyển. Đợt ĐÃ phát
     * không đụng — `gift_grants.snapshot` đóng băng (spec §5.3).
     */
    createdByDepartmentId: uuid("created_by_department_id").references(() => departments.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_id_number").on(t.idNumber).where(sql`id_number is not null`),
    index("customers_search_name_trgm").using("gin", sql`search_name gin_trgm_ops`),
    index("customers_id_last4").on(sql`right(id_number, 4)`).where(sql`id_number is not null`),
    // Khớp đúng thứ tự sắp mặc định của P-40 (nhiều nhất lên trước, đồng hạng
    // thì theo tên) — có index thì lấy 15 dòng đầu không phải xếp cả kho.
    index("customers_account_count").on(sql`account_count desc, search_name`),
    index("customers_insurance_count").on(sql`insurance_count desc, search_name`),
    /**
     * Điểm KPI ngân hàng gom theo CHỦ HỒ SƠ KHÁCH từ 07/08 (thể lệ câu 7.11),
     * nên `recomputeKpi` lọc `customers.created_by` rồi mới nối sang tài khoản.
     * Không có chỉ mục này thì mỗi lần hoàn thành một tài khoản là một lượt
     * quét cả bảng khách.
     */
    index("customers_creator").on(t.createdBy),
    /**
     * Cột "Khách hàng" của bảng nhân sự P-51 đếm khách một người lập TRONG một
     * kỳ (`countsInRange` ở `server/people.ts`).
     *
     * `customers_creator` một cột không đủ: Postgres đọc mọi khách của người đó
     * rồi mới lọc ngày ở bước `Filter`. Một nhân viên tích luỹ 30.000 khách thì
     * mỗi lượt mở bảng đọc 30.000 dòng để ra một con số — đúng hình dạng câu
     * hỏi mà AGENTS.md §5.2 cấm. Hai bảng kia đã có chỉ mục ghép tương ứng
     * (`bank_accounts_creator_date`, `services_creator_date`).
     */
    index("customers_creator_date").on(t.createdBy, t.createdAt),
    /**
     * P-40 lọc theo PHÒNG của người lập từ 2026-08-23: cấp quản lý chỉ thấy
     * khách phòng mình. Khớp đúng khoá sắp mặc định `created_at desc, id`, nếu
     * không thì mỗi lượt mở bảng là một lượt xếp lại cả kho để lấy 15 dòng.
     */
    index("customers_dept_date").on(
      sql`created_by_department_id, created_at desc, id`,
    ),
    /**
     * P-40 lọc theo trạng thái quà, P-80 đếm "đủ ĐK chưa phát" — cả hai đều hỏi
     * "khách nào có `gift_case`". Chỉ mục một phần vì đại đa số khách chưa đủ
     * combo nào, để `null` ra ngoài thì chỉ mục nhỏ hơn hẳn.
     */
    index("customers_gift_basket").on(t.id).where(sql`cardinality(gift_basket) > 0`),
  ],
);

export const customerPhones = pgTable(
  "customer_phones",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    number: text("number").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    index("customer_phones_number").on(t.number),
    index("customer_phones_customer").on(t.customerId),
    uniqueIndex("customer_phones_one_primary").on(t.customerId).where(sql`is_primary`),
    /**
     * Ô tìm ở P-40 cho gõ một KHÚC số ("912345"), mà `like '%…%'` thì chỉ mục
     * btree ở trên không đỡ được — nó chỉ đỡ khi biết trước phần đầu.
     * Đo ở 333.000 số: không có chỉ mục này 18ms, có thì 2ms.
     */
    index("customer_phones_number_trgm").using("gin", sql`number gin_trgm_ops`),
  ],
);

/* ── §4 · Nghiệp vụ ─────────────────────────────────────────────────── */

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    bankId: uuid("bank_id").notNull().references(() => banks.id),
    /** Giữ chỗ NGAY từ bước 1 — tài khoản `creating` chính là lượt giữ (spec §4.5). */
    referralCodeId: uuid("referral_code_id").notNull().references(() => referralCodes.id),
    status: bankAccountStatus("status").notNull().default("creating"),
    /** Lý do đối soát loại tài khoản ra khỏi KPI; rỗng khi không ở trạng thái lỗi. */
    errorNote: text("error_note").notNull().default(""),
    accountNumber: text("account_number"),
    openedDate: date("opened_date"),
    /** Trường quyết định quà. */
    appInstalled: boolean("app_installed").notNull().default(false),
    /**
     * Ngày khách phát sinh giao dịch. `null` = chưa ghi nhận.
     *
     * Ghi MUỘN, sau khi tài khoản đã `done` (spec §4.2 bước 3) — hôm nay mở tài
     * khoản, hôm sau chuyển khoản giúp khách rồi quay lại điền. Trùng ngày mở
     * vẫn hợp lệ (chốt 07/08).
     */
    transactionAt: date("transaction_at"),
    /** Chỉ có nghĩa khi ngân hàng = VPa — kiểm ở app (ngân hàng là dữ liệu). */
    accountType: bankAccountType("account_type").notNull().default("none"),
    note: text("note").notNull().default(""),
    /** Snapshot kênh từ khách lúc mở — không nhập lại. */
    channelId: uuid("channel_id").references(() => channels.id),
    channelDetail: text("channel_detail").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id),
    /** Snapshot phòng lúc tạo (#8) — trục lọc phạm vi. */
    createdByDepartmentId: uuid("created_by_department_id").references(() => departments.id),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bank_accounts_customer").on(t.customerId),
    /**
     * Một khách chỉ mở được MỘT tài khoản ở MỘT ngân hàng (chốt 2026-08-25).
     *
     * Tính cả dòng `creating`: dòng đó đã giữ một chỗ mã giới thiệu, nên mở lần
     * hai cùng ngân hàng là mở trùng chứ không phải mở thêm. Xoá bản nháp thì
     * chỗ nhả ra và mở lại được.
     *
     * Trần 3 tài khoản mỗi khách KHÔNG nằm ở đây — ràng buộc đếm dòng thì phải
     * dựng trigger. Nó nằm ở `startBankAccount`, trong cùng giao dịch và có
     * khoá dòng khách.
     */
    uniqueIndex("bank_accounts_customer_bank").on(t.customerId, t.bankId),
    index("bank_accounts_referral").on(t.referralCodeId, t.status),
    index("bank_accounts_dept_date").on(t.createdByDepartmentId, t.openedDate),
    // Tính điểm KPI gom theo NGƯỜI TẠO trong một khoảng ngày (§9), không lọc
    // theo phòng — index dẫn đầu bằng department_id ở trên không dùng được.
    index("bank_accounts_creator_date").on(t.createdBy, t.openedDate),
    /**
     * Khớp ĐÚNG `ORDER BY` của P-21:
     * `opened_date desc nulls last, created_at desc, id`.
     *
     * `nulls last` là bắt buộc về nghiệp vụ — tài khoản `creating` chưa có ngày
     * mở, mà mặc định Postgres xếp NULL lên đầu khi giảm dần nên bảng mở ra
     * toàn bản nháp. Nhưng nó cũng làm hai index ở trên hết dùng được: đo trên
     * 20.000 dòng, câu lấy trang chuyển từ Index Scan (116 buffer, 0,16ms) sang
     * Seq Scan toàn bảng (1703 buffer, 5,3ms) — và câu đếm tổng là lượt quét
     * thứ hai. Hai index dưới đây khai đúng thứ tự đó nên dùng lại được.
     *
     * `created_at` ở giữa là khoá phá hoà (migration 0018). Bỏ nó khỏi index mà
     * vẫn để trong `ORDER BY` thì kế hoạch rơi từ Index Scan → Limit sang
     * Sort → Limit, mà Sort không chảy được: nó nuốt trọn đầu vào rồi mới nhả
     * dòng đầu tiên, nên mọi trang đều trả giá chứ không riêng trang cuối.
     */
    index("bank_accounts_dept_opened").on(
      sql`created_by_department_id, opened_date desc nulls last, created_at desc, id`,
    ),
    index("bank_accounts_opened").on(sql`opened_date desc nulls last, created_at desc, id`),
    /**
     * Bản TĂNG DẦN của hai chỉ mục trên — bấm tiêu đề cột "Ngày" lần thứ hai.
     *
     * Postgres đọc ngược `opened_date desc nulls last` ra `asc nulls FIRST`, mà
     * câu truy vấn hỏi `asc nulls last`. Lệch ngay khoá đầu nên planner bỏ hẳn
     * chỉ mục: đo trên 200.000 dòng là Seq Scan 19,7 ms so với 0,07 ms.
     *
     * `insurance_orders` và `services` không cần cặp này. Chỉ mục của chúng khai
     * `desc` trơn, đọc ngược ra `asc nulls last` khớp đúng khoá đầu; chỉ khoá
     * cuối `id` lệch và `Incremental Sort` chữa được.
     */
    index("bank_accounts_dept_opened_asc").on(
      sql`created_by_department_id, opened_date asc nulls last, created_at asc, id asc`,
    ),
    index("bank_accounts_opened_asc").on(sql`opened_date asc nulls last, created_at asc, id asc`),
    check(
      "bank_accounts_done_filled",
      sql`status = 'creating' or (account_number is not null and opened_date is not null)`,
    ),
    /* ❌ bank_accounts_transaction_other_day: BỎ 07/08 (migration 0017). Dựng
       theo chữ "khác ngày mở tk" của thể lệ mục 1, nhưng CEO xác nhận đọc vậy
       là sai — giao dịch ngay trong ngày mở vẫn tính. */
  ],
);

export const bankAccountPhotos = pgTable(
  "bank_account_photos",
  {
    id: id(),
    /** Cascade duy nhất trong schema — ảnh chết theo tài khoản `creating` bị bỏ dở. */
    accountId: uuid("account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    /**
     * Luật "đủ ảnh mới cho Hoàn thành" chỉ đếm ảnh `opening` so với
     * `banks.required_photos` — ảnh giao dịch nộp muộn hơn nhiều, đếm chung là
     * tài khoản tự "đủ ảnh" sai.
     */
    kind: photoKind("kind").notNull().default("opening"),
    /**
     * KHOÁ trong kho (`bank-accounts/<ngày>/<uuid>.webp`), KHÔNG phải URL.
     *
     * Tên cột giữ nguyên từ bản trước để khỏi kéo theo một lượt đổi tên cột;
     * `server/storage.ts` dựng URL từ khoá này lúc đọc. Migration 0031 cắt tiền
     * tố `/uploads/` của dữ liệu cũ.
     */
    url: text("url").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [index("bank_account_photos_account").on(t.accountId)],
);

/**
 * Ảnh mẫu đi kèm hướng dẫn của một ngân hàng.
 *
 * Bảng riêng chứ không phải cột mảng: ảnh có THỨ TỰ, và thứ tự đó phải khớp
 * phần "Ảnh 1 · Ảnh 2 …" người nhập viết trong `banks.guide`.
 *
 * `url` giữ KHOÁ trong kho ảnh, không giữ URL — cùng luật `bank_account_photos`,
 * tên cột cũng giữ nguyên cho khớp.
 */
export const bankGuidePhotos = pgTable(
  "bank_guide_photos",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [index("bank_guide_photos_bank").on(t.bankId)],
);

export const giftGrants = pgTable("gift_grants", {
  id: id(),
  /** Một khách đúng MỘT đợt tặng — không có đợt thứ hai (P-43). */
  customerId: uuid("customer_id").notNull().unique().references(() => customers.id),
  grantedBy: uuid("granted_by").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  cashTotal: integer("cash_total").notNull().default(0),
  /** Tên món đã chọn, hoặc câu mô tả việc từ chối. */
  chosenItem: text("chosen_item").notNull(),
  /** Rổ quà + breakdown ĐÓNG BĂNG lúc chốt — chỗ jsonb có chủ đích duy nhất. */
  snapshot: jsonb("snapshot").notNull(),
});

/** Mỗi lần đổi quà là một sự kiện độc lập, không ghi đè mất dấu vết đã phát. */
export const giftGrantChanges = pgTable(
  "gift_grant_changes",
  {
    id: id(),
    giftGrantId: uuid("gift_grant_id")
      .notNull()
      .references(() => giftGrants.id),
    fromChosenItem: text("from_chosen_item").notNull(),
    toChosenItem: text("to_chosen_item").notNull(),
    reason: text("reason").notNull(),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gift_grant_changes_grant_time").on(t.giftGrantId, t.changedAt)],
);

export const insuranceOrders = pgTable(
  "insurance_orders",
  {
    id: id(),
    /** DH-YYMM-NNN — sinh lúc tạo, không đổi. */
    orderCode: text("order_code").notNull().unique(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    product: insuranceProduct("product").notNull(),
    packageId: uuid("package_id").references(() => insurancePackages.id),
    /** Snapshot tên gói lúc tạo — đổi tên gói không viết lại đơn cũ. */
    packageName: text("package_name").notNull(),
    /** Mức phí của ĐƠN — prefill từ gói, người nhập sửa được từng đơn. */
    fee: integer("fee").notNull().default(0),
    /**
     * NGÀY TẠO ĐƠN — ngày nhân viên thật sự lập đơn cho khách, và là ngày mọi
     * phép tính theo kỳ dựa vào (KPI, dashboard, bộ lọc P-13).
     *
     * Cột RIÊNG chứ không mượn `created_at`, cùng lối với `bank_accounts.opened_date`
     * và `services.service_date` — ba bảng nghiệp vụ cùng một hình dạng:
     * một ngày nghiệp vụ sửa được, cộng `created_at` bất biến.
     *
     * Kiểu `date` (không giờ) là phần đáng giá nhất: so khoảng ngày dùng thẳng
     * được chỉ mục, còn `(created_at at time zone …)::date` thì không khớp chỉ
     * mục nào và phải viết lại phép quy múi giờ ở mọi chỗ đọc.
     *
     * ⚠️ CỐ Ý KHÔNG CÓ DEFAULT. `current_date` chạy theo TimeZone của phiên kết
     * nối, mà máy chủ để UTC — nên từ 0h đến 7h sáng giờ Việt Nam nó trả về HÔM
     * QUA, đúng cái bẫy cả cột này sinh ra để dẹp. Không default thì đường ghi
     * nào quên truyền sẽ hỏng ồn ào ngay, thay vì lặng lẽ ghi sai ngày.
     */
    orderDate: date("order_date").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: insuranceOrderStatus("status").notNull().default("queued"),
    source: insuranceOrderSource("source").notNull(),
    /** Nối đơn quà về đợt tặng sinh ra nó; null khi source='self'. */
    giftGrantId: uuid("gift_grant_id").references(() => giftGrants.id),
    /** Người thụ hưởng có thể KHÁC khách (spec §5.4). */
    beneficiaryName: text("beneficiary_name").notNull(),
    beneficiaryDob: date("beneficiary_dob"),
    beneficiaryIdNumber: text("beneficiary_id_number").notNull().default(""),
    beneficiaryPhone: text("beneficiary_phone").notNull().default(""),
    /** BH tai nạn điện tính theo HỘ nên địa chỉ là thông tin lõi; đơn xe máy cũng thu. */
    beneficiaryAddress: text("beneficiary_address").notNull().default(""),
    /** Ô `SoNguoi_HoKhau` của PVI — số người cùng địa chỉ thường trú. 0 với đơn xe máy. */
    householdSize: smallint("household_size").notNull().default(0),
    /**
     * Số tiền bảo hiểm — mức CHI TRẢ khi có tai nạn (40 hoặc 80 triệu), ô
     * `STBH__quytac_hienhanh` của PVI.
     *
     * KHÁC `fee` và không suy ra được từ nhau: `fee` là phí khách trả, PVI hỏi
     * cả hai ở hai ô riêng rồi tự nhân `sum_insured` với tỷ lệ phí ra tổng phí
     * bên họ. Lẫn hai con số là ghi sai hợp đồng.
     */
    sumInsured: integer("sum_insured").notNull().default(0),
    licensePlate: text("license_plate").notNull().default(""),
    /** Mã loại xe của PVI (`1001`…) — danh sách cố định ở `src/lib/pvi.ts`. */
    vehicleType: text("vehicle_type").notNull().default(""),
    chassisNumber: text("chassis_number").notNull().default(""),
    engineNumber: text("engine_number").notNull().default(""),
    /** Ảnh chứng nhận — thay PDF, đính được ở mọi trạng thái. */
    /** KHOÁ trong kho, không phải URL — xem `bank_account_photos.url`. */
    certificatePhotoUrl: text("certificate_photo_url"),
    /**
     * "Số đơn ĐT" bên PVI — `26/21/14/TNCN/0096592`. Bot đọc ở BẢNG
     * `/Service/Manager`; màn duyệt không hiện số này.
     */
    pviElectronicOrderNo: text("pvi_electronic_order_no").notNull().default(""),
    /**
     * Link file PDF giấy chứng nhận — trường `URL` của callback mục 13 API đối
     * tác PVI. URL TUYỆT ĐỐI trỏ sang máy chủ PVI, giao diện đưa thẳng vào thẻ
     * `a`.
     *
     * KHÁC `certificate_photo_url`: cột đó là KHOÁ ảnh trong kho S3 do bot
     * Playwright chụp lại, phải đi qua `GET /api/images/<key>` mới đọc được.
     *
     * Rỗng = chưa nhận callback, hoặc đơn do bot tạo chứ không qua API.
     */
    pviCertificateUrl: text("pvi_certificate_url").notNull().default(""),
    /**
     * Số ấn chỉ điện tử — trường `SerialNumber` của callback mục 13.
     *
     * KHÁC `pvi_electronic_order_no` là SỐ ĐƠN dạng `26/21/14/MOTO/0109539`.
     * Trên màn PVI hai số nằm cạnh nhau: "Số đơn điện tử" và "Số ấn chỉ".
     */
    pviSerialNumber: text("pvi_serial_number").notNull().default(""),
    /**
     * Khoá PVI dùng trong mọi đường dẫn thao tác trên đơn. Lưu dạng THÔ
     * (`W6fXX4Fd7+I=`), mã hoá url lúc dựng địa chỉ.
     *
     * KHÔNG unique: bot khớp đơn PVI về đơn của mình bằng tên khách cộng sản
     * phẩm, mà hai đơn liền kề năm của cùng một khách giống nhau mọi thông tin
     * hiện trên màn duyệt — xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`.
     */
    pviPrKey: text("pvi_pr_key").notNull().default(""),
    /** Số lần luồng 3 đã hỏi `/Service/DownloadFile` mà chưa có file. */
    certificateAttempts: smallint("certificate_attempts").notNull().default(0),
    certificateCheckedAt: timestamp("certificate_checked_at", { withTimezone: true }),
    /**
      * Người XỬ LÝ TAY — ghi lúc bấm "Nhận đơn xử lý", null với đơn bot chạy
      * trơn. Khác `created_by` (người tạo): hai người khác nhau, và mở đơn phải
      * thấy ngay ai đang cầm để hai người không giẫm chân nhau.
      */
    handledBy: uuid("handled_by").references(() => users.id),
    /**
     * Snapshot phòng của người xử lý, chụp LÚC NHẬN ĐƠN (#8).
     *
     * Luật nhìn thấy đơn cho cấp quản lý của CẢ HAI phòng — phòng người tạo và
     * phòng người xử lý — nên trục thứ hai cũng phải chụp. Tra động
     * `users.department_id` thì người xử lý chuyển phòng là quản lý phòng cũ mất
     * quyền xem đơn họ từng phụ trách.
     */
    handledByDepartmentId: uuid("handled_by_department_id").references(() => departments.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdByDepartmentId: uuid("created_by_department_id").references(() => departments.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("insurance_orders_customer").on(t.customerId),
    index("insurance_orders_status").on(t.status),
    /** Luồng duyệt tra đơn chờ duyệt theo tên người thụ hưởng và sản phẩm. */
    index("insurance_orders_pending_match").on(t.status, t.product, t.beneficiaryName),
    /** Luồng 3 quét đơn đang đợi file, cũ nhất trước. */
    index("insurance_orders_awaiting_certificate").on(
      sql`status, certificate_checked_at nulls first`,
    ),
    /**
     * Khớp đúng thứ tự P-13 lấy một trang: `created_at desc, id`, có hoặc không
     * kèm bộ lọc phạm vi. Thiếu chỉ mục đúng hình dạng này thì Postgres phải
     * xếp lại toàn bộ kết quả khớp bộ lọc trước khi cắt 15 dòng, tức quét cả
     * kho để lấy một trang.
     *
     * Sắp theo NGÀY TẠO ĐƠN, không theo ngày hiệu lực. `created_at` là khoá phá
     * hoà — `order_date` không có giờ nên mọi đơn cùng ngày đều hoà, và thiếu
     * khoá này thì đơn vừa tạo rơi vào giữa bảng. Xem `orderByDate` ở
     * `server/insurance.ts`.
     */
    index("insurance_orders_dept_date").on(
      sql`created_by_department_id, order_date desc, created_at desc, id`,
    ),
    index("insurance_orders_creator_date").on(
      sql`created_by, order_date desc, created_at desc, id`,
    ),
    /**
     * Trục NGƯỜI XỬ LÝ, đối xứng với hai chỉ mục trên (migration 0020).
     *
     * Luật nhìn thấy đơn lọc theo cả hai trục — người tạo và người nhận xử lý
     * tay — nên cả hai đều cần chỉ mục cùng hình dạng. Hai dòng này có trong
     * database từ 0020 nhưng thiếu ở đây, nên `schema.ts` mô tả sai kho thật.
     */
    index("insurance_orders_handler_dept_date").on(
      sql`handled_by_department_id, order_date desc, created_at desc, id`,
    ),
    index("insurance_orders_handler_date").on(
      sql`handled_by, order_date desc, created_at desc, id`,
    ),
    index("insurance_orders_date").on(sql`order_date desc, created_at desc, id`),
    check(
      "insurance_orders_motorbike_plate",
      sql`product <> 'motorbike' or license_plate <> ''`,
    ),
    check(
      "insurance_orders_motorbike_vehicle_type",
      sql`product <> 'motorbike' or vehicle_type <> ''`,
    ),
    check("insurance_orders_fee_positive", sql`fee >= 0`),
    check("insurance_orders_household_size_non_negative", sql`household_size >= 0`),
    check("insurance_orders_sum_insured_non_negative", sql`sum_insured >= 0`),
  ],
);

export const insuranceOrderStatusHistory = pgTable(
  "insurance_order_status_history",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => insuranceOrders.id),
    /** null = dòng khởi tạo. */
    fromStatus: insuranceOrderStatus("from_status"),
    toStatus: insuranceOrderStatus("to_status").notNull(),
    /** null = hệ thống/bot tự chuyển. */
    changedBy: uuid("changed_by").references(() => users.id),
    /** Lý do đổi trạng thái. Rỗng ở mọi lượt trừ lượt huỷ đơn, nơi nó bắt buộc. */
    note: text("note").notNull().default(""),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insurance_history_order").on(t.orderId)],
);

/** Sinh mã đơn không đụng nhau — update … returning trong cùng transaction với insert. */
export const orderCodeCounters = pgTable("order_code_counters", {
  yearMonth: text("year_month").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

export const services = pgTable(
  "services",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    serviceTypeId: uuid("service_type_id").notNull().references(() => serviceTypes.id),
    /** Không có trường tiền — dịch vụ miễn phí toàn bộ (spec §6). */
    note: text("note").notNull().default(""),
    serviceDate: date("service_date").notNull().default(sql`current_date`),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdByDepartmentId: uuid("created_by_department_id").references(() => departments.id),
    wardId: uuid("ward_id").references(() => wards.id),
    /** Snapshot tên xã lúc tạo — đổi xã phụ trách không đổi dữ liệu tháng trước. */
    wardName: text("ward_name"),
    createdAt: createdAt(),
  },
  (t) => [
    index("services_dept_date").on(t.createdByDepartmentId, t.serviceDate),
    index("services_creator_date").on(t.createdBy, t.serviceDate),
    index("services_customer").on(t.customerId),
    // Khớp `ORDER BY service_date desc, created_at desc, id` của P-31. Thiếu nó
    // thì phạm vi toàn công ty quét cả bảng, hai lượt mỗi lần mở màn — đo trên
    // 300.000 dòng: 14ms cho câu lấy trang, 43ms cho câu đếm.
    index("services_date").on(sql`service_date desc, created_at desc, id`),
    // Ô lọc "Xã" ở P-31 — không có index này thì ai bấm cũng seq scan (74ms).
    index("services_ward").on(t.wardId),
  ],
);

/* ── §5 · Quà & KPI ─────────────────────────────────────────────────── */

/* ❌ `gift_rules` + `gift_rule_items` ĐÃ BỎ (chốt 03/08) — quy tắc quà và công
   thức điểm KPI chuyển sang module code theo kỳ (`src/rules/YYYY-MM.ts`, spec
   §5.3). Thể lệ đổi theo tháng và đổi cả HÌNH DẠNG luật (combo, hạng ngân
   hàng, cấm bank theo combo, quy đổi quà theo phòng) — nhét vào bảng cấu hình
   là phải dựng một ngôn ngữ lập trình bên trong database.
   `gift_items` và `insurance_packages` VẪN ở đây: chúng là thực thể có thật,
   file luật trỏ vào bằng cột `code`. */

export const kpiTargets = pgTable(
  "kpi_targets",
  {
    id: id(),
    /** '2026-08'. */
    yearMonth: text("year_month").notNull(),
    /** null = mốc chung toàn công ty; có phòng thì đè mốc chung. */
    departmentId: uuid("department_id").references(() => departments.id),
    monthlyPoints: integer("monthly_points").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("kpi_targets_month_dept")
      .on(t.yearMonth, t.departmentId)
      .where(sql`department_id is not null`),
    uniqueIndex("kpi_targets_month_company").on(t.yearMonth).where(sql`department_id is null`),
    check("kpi_targets_points_positive", sql`monthly_points > 0`),
  ],
);

/**
 * Điểm KPI đã tính, một dòng mỗi người mỗi tháng.
 *
 * ⚠️ Đây là ngoại lệ so với `mgst-db-design.md` §9 ("điểm KPI không lưu"). Lý do
 * ghi ở đó — *"lưu điểm là khoá cứng quá khứ vào hệ số cũ"* — đúng với thiết kế
 * CŨ, khi hệ số nằm trong DB và admin sửa được, sửa xong thì mọi tháng cũ phải
 * chấm lại. Quyết định 03/08 đổi hẳn: công thức vào `src/rules/YYYY-MM.ts` và
 * **file của kỳ đã qua đóng băng vĩnh viễn**. Điểm tháng đã đóng không thể đổi
 * nữa, nên lưu nó không khoá cứng gì cả.
 *
 * Đổi lại được: điểm nằm sẵn ở đây thì `ORDER BY điểm / chỉ tiêu` chạy được
 * trong SQL, tức màn Nhân sự sắp xếp và phân trang ở máy chủ được — điều không
 * làm nổi khi điểm tính sống trong lúc truy vấn.
 *
 * Cập nhật bằng `recomputeKpi` (`src/server/kpi.ts`), KHÔNG ghi tay.
 */
export const kpiScores = pgTable(
  "kpi_scores",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** '2026-08'. Chỉ theo THÁNG — xem "hôm nay" không hiện cột chỉ tiêu. */
    yearMonth: text("year_month").notNull(),
    /** Từ module luật của kỳ. Thang mới là số thực (0.4–1.2 mỗi combo). */
    bankingPoints: numeric("banking_points", { precision: 10, scale: 2 }).notNull().default("0"),
    /** Σ hệ số loại dịch vụ — spec §7.2 giữ cách cũ, vẫn ở DB. */
    servicePoints: numeric("service_points", { precision: 10, scale: 2 }).notNull().default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.yearMonth] }),
    /** Bảng xếp hạng đọc theo tháng rồi sắp theo điểm. */
    index("kpi_scores_month").on(t.yearMonth),
  ],
);

/**
 * Điểm cộng tay theo tháng, mỗi lần cộng một dòng — quyền `system:adjust-kpi`.
 *
 * Bảng RIÊNG, không phải cột thứ ba của `kpi_scores`: `recomputeKpiOn` XOÁ dòng
 * `kpi_scores` khi người đó thuộc phòng `office` — điểm cộng tay nằm chung là
 * mất theo lượt tính lại. Tổng điểm cộng gộp lúc truy vấn (`adjustmentExpr`).
 *
 * `points` cho phép ÂM — trừ điểm cũng đi đường này.
 */
export const kpiAdjustments = pgTable(
  "kpi_adjustments",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** '2026-08'. Luôn là tháng hiện tại lúc ghi — P-52 không cộng cho tháng cũ. */
    yearMonth: text("year_month").notNull(),
    points: numeric("points", { precision: 10, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("kpi_adjustments_user_month").on(t.userId, t.yearMonth),
    check("kpi_adjustments_points_nonzero", sql`points <> 0`),
  ],
);

/* ── §6 · Hệ thống ──────────────────────────────────────────────────── */

/** Append-only — không có UPDATE/DELETE ở tầng app. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    module: moduleKey("module").notNull(),
    action: actionKey("action").notNull(),
    targetLabel: text("target_label").notNull(),
    targetTable: text("target_table"),
    targetId: text("target_id"),
    detail: jsonb("detail"),
  },
  (t) => [
    index("audit_log_at").on(t.at.desc()),
    index("audit_log_actor").on(t.actorId, t.at.desc()),
  ],
);

export const pviAccounts = pgTable("pvi_accounts", {
  id: id(),
  username: text("username").notNull().unique(),
  /** Mã hoá HAI CHIỀU (bot cần đọc lại để đăng nhập PVI) — không bao giờ trả về UI. */
  passwordEncrypted: text("password_encrypted").notNull(),
  active: boolean("active").notNull().default(true),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
});

/**
 * P-96 · Góp ý của nhân viên. Ai đăng nhập cũng gửi được; đọc và đánh dấu đã
 * xử lý thì cần `system:handle-feedback`.
 *
 * Không lưu tên người gửi, nối sang `users` lúc đọc — tên đổi thì góp ý cũ
 * phải đổi theo, mà bảng này nhỏ nên nối 15 dòng không tốn gì.
 */
export const feedbacks = pgTable(
  "feedbacks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    /** Đường dẫn trang lúc người dùng bấm nút Góp ý. */
    path: text("path").notNull().default(""),
    status: feedbackStatus("status").notNull().default("pending"),
    handledBy: uuid("handled_by").references(() => users.id),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("feedbacks_created").on(t.createdAt.desc()),
    index("feedbacks_status_created").on(t.status, t.createdAt.desc()),
    check("feedbacks_content_not_blank", sql`btrim(content) <> ''`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: notificationKind("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user").on(t.userId, t.createdAt.desc())],
);

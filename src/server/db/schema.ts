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
  "customer", "insurance", "banking", "services", "staff", "system", "*",
]);

export const actionKey = pgEnum("action_key", [
  "view-summary", "view-detail", "create", "update", "delete", "export",
  "handle-fallback", "grant-gift", "manage-referral-codes",
  "manage-bank-catalog", "configure-catalog", "configure-gift-rules",
  "manage-org", "grant-permission",
  // đặc biệt · customer: XEM + SỬA CCCD đầy đủ, gộp một quyền (quyết định 03/08)
  "access-id-number",
]);

export const scopeKey = pgEnum("scope_key", ["own", "managed", "company"]);
export const roleKey = pgEnum("role_key", [
  "director", "deputy-director", "head", "deputy-head", "staff",
]);
export const manageScope = pgEnum("manage_scope", ["none", "listed", "company"]);

export const accountNumberMethod = pgEnum("account_number_method", ["phone-match", "manual"]);
export const bankAccountType = pgEnum("bank_account_type", ["none", "CNKD", "HKD"]);
export const bankAccountStatus = pgEnum("bank_account_status", ["creating", "done"]);

export const insuranceProduct = pgEnum("insurance_product", ["motorbike", "electric-accident"]);
export const insuranceOrderStatus = pgEnum("insurance_order_status", [
  "queued", "creating", "pending-approval", "manual-queued", "manual-progress", "done",
]);
export const insuranceOrderSource = pgEnum("insurance_order_source", ["self", "gift"]);

export const channelInputKind = pgEnum("channel_input_kind", [
  "ward-hamlet", "hospital", "free-text", "none",
]);
export const giftGroup = pgEnum("gift_group", ["cash", "choice"]);
export const giftRuleMode = pgEnum("gift_rule_mode", ["accumulate", "tiered", "addon"]);
export const appCountComparator = pgEnum("app_count_comparator", ["none", "eq", "gte"]);

export const notificationKind = pgEnum("notification_kind", [
  "order-done", "order-manual", "code-low",
]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true });

/* ── §1 · Tổ chức & tài khoản ───────────────────────────────────────── */

export const departments = pgTable("departments", {
  id: id(),
  name: text("name").notNull().unique(),
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
    /** Chỉ nhân viên phòng Dự Án. */
    wardId: uuid("ward_id").references(() => wards.id),
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
  (t) => [uniqueIndex("sessions_token_hash").on(t.tokenHash)],
);

/* ── §2 · Danh mục ──────────────────────────────────────────────────── */

export const banks = pgTable("banks", {
  id: id(),
  /** VPa/VPb, MSBa/MSBb là các ngân hàng RIÊNG — không gộp cha–con (spec §2.6). */
  code: text("code").notNull().unique(),
  active: boolean("active").notNull().default(true),
  requiredPhotos: smallint("required_photos").notNull().default(3),
  accountNumberMethod: accountNumberMethod("account_number_method")
    .notNull()
    .default("phone-match"),
  /** Hệ số điểm KPI — VPb = 1.4. */
  coefficient: numeric("coefficient", { precision: 4, scale: 2 }).notNull().default("1"),
  /** false với CNKD/HKD — tính điểm nhưng không đếm vào tổng app xét quà. */
  countsAsApp: boolean("counts_as_app").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: id(),
    bankId: uuid("bank_id").notNull().references(() => banks.id),
    code: text("code").notNull(),
    total: integer("total").notNull(),
    /** Số đã dùng TRƯỚC khi nhập vào hệ thống (P-62). `used`/`holding` sống thì ĐẾM từ bank_accounts. */
    importedUsed: integer("imported_used").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("referral_codes_bank_code").on(t.bankId, t.code),
    check("referral_codes_total_positive", sql`total > 0`),
  ],
);

export const channels = pgTable("channels", {
  id: id(),
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
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const insurancePackages = pgTable("insurance_packages", {
  id: id(),
  name: text("name").notNull().unique(),
  /** Đồng/năm. */
  yearlyFee: integer("yearly_fee").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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

export const wards = pgTable("wards", {
  id: id(),
  provinceId: uuid("province_id").notNull().references(() => provinces.id),
  refId: text("ref_id").notNull().unique().references(() => refWards.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const hamlets = pgTable("hamlets", {
  id: id(),
  wardId: uuid("ward_id").notNull().references(() => wards.id),
  /** Ấp KHÔNG có nguồn tham chiếu — luôn nhập tay. */
  name: text("name").notNull(),
  createdAt: createdAt(),
});

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
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_id_number").on(t.idNumber).where(sql`id_number is not null`),
    index("customers_search_name_trgm").using("gin", sql`search_name gin_trgm_ops`),
    index("customers_id_last4").on(sql`right(id_number, 4)`).where(sql`id_number is not null`),
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
    accountNumber: text("account_number"),
    openedDate: date("opened_date"),
    /** Trường quyết định quà. */
    appInstalled: boolean("app_installed").notNull().default(false),
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
    index("bank_accounts_referral").on(t.referralCodeId, t.status),
    index("bank_accounts_dept_date").on(t.createdByDepartmentId, t.openedDate),
    check(
      "bank_accounts_done_filled",
      sql`status = 'creating' or (account_number is not null and opened_date is not null)`,
    ),
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
    url: text("url").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [index("bank_account_photos_account").on(t.accountId)],
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
    licensePlate: text("license_plate").notNull().default(""),
    chassisNumber: text("chassis_number").notNull().default(""),
    engineNumber: text("engine_number").notNull().default(""),
    /** Ảnh chứng nhận — thay PDF, đính được ở mọi trạng thái. */
    certificatePhotoUrl: text("certificate_photo_url"),
    createdBy: uuid("created_by").references(() => users.id),
    createdByDepartmentId: uuid("created_by_department_id").references(() => departments.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("insurance_orders_customer").on(t.customerId),
    index("insurance_orders_status").on(t.status),
    index("insurance_orders_dept_date").on(t.createdByDepartmentId, t.startDate),
    check(
      "insurance_orders_motorbike_plate",
      sql`product <> 'motorbike' or license_plate <> ''`,
    ),
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
    index("services_customer").on(t.customerId),
  ],
);

/* ── §5 · Quà & KPI ─────────────────────────────────────────────────── */

export const giftRules = pgTable("gift_rules", {
  id: id(),
  /** Bậc thang khớp dòng nhỏ nhất trước rồi dừng. */
  sortOrder: integer("sort_order").notNull(),
  giftGroup: giftGroup("gift_group").notNull(),
  /** `cash` luôn đi với `accumulate` — kiểm ở app. */
  mode: giftRuleMode("mode").notNull(),
  requiredBankId: uuid("required_bank_id").references(() => banks.id),
  /** Cờ riêng — "mở CNKD ở HKD" không phải một ngân hàng. */
  requiresCnkd: boolean("requires_cnkd").notNull().default(false),
  appCountComparator: appCountComparator("app_count_comparator").notNull().default("none"),
  appCountValue: smallint("app_count_value"),
  channelId: uuid("channel_id").references(() => channels.id),
  cashAmount: integer("cash_amount"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const giftRuleItems = pgTable(
  "gift_rule_items",
  {
    id: id(),
    ruleId: uuid("rule_id").notNull().references(() => giftRules.id),
    giftItemId: uuid("gift_item_id").references(() => giftItems.id),
    insurancePackageId: uuid("insurance_package_id").references(() => insurancePackages.id),
  },
  (t) => [
    /** Món trong rổ là quà vật lý HOẶC gói bảo hiểm — đúng một FK có giá trị. */
    check(
      "gift_rule_items_one_target",
      sql`num_nonnulls(gift_item_id, insurance_package_id) = 1`,
    ),
    index("gift_rule_items_rule").on(t.ruleId),
  ],
);

export const kpiTargets = pgTable(
  "kpi_targets",
  {
    id: id(),
    /** '2026-08'. */
    yearMonth: text("year_month").notNull(),
    /** null = mốc chung toàn công ty; có phòng thì đè mốc chung. */
    departmentId: uuid("department_id").references(() => departments.id),
    monthlyPoints: integer("monthly_points").notNull(),
    warnDaysLeft: smallint("warn_days_left").notNull().default(0),
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

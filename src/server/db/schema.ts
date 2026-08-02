import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
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
 * Schema Postgres — nguồn: ../../../mgst-db-design.md (bên cạnh mgst-platform-spec.md).
 *
 * ĐỢT NÀY chỉ tạo 6 bảng phục vụ đăng nhập + Phòng ban + Nhân sự & phân quyền.
 * Enum thì tạo đủ cả 16 (một lần cho xong, các bảng sau dùng dần).
 *
 * ⚠️ Sai lệch CÓ CHỦ ĐÍCH so với design doc: `users.id` và `departments.id` là
 * TEXT chứ không phải uuid — seed giữ nguyên id chuỗi từ src/mocks/data.ts
 * ("u-director", "kd-2", "p2"…) vì các module còn chạy mock (banking, insurance,
 * people…) tra actor bằng đúng các id đó. TODO: chuyển uuid khi module cuối rời mock.
 */

/* ── 16 enum theo mgst-db-design.md §0 ──────────────────────────────── */

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

/* ── Tổ chức & tài khoản (mgst-db-design.md §1) ─────────────────────── */

export const departments = pgTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    /** Băm một chiều (bcrypt) — không có đường đọc lại (C-02). */
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    /** Chức vụ = bộ quyền mặc định lúc tạo, KHÔNG phải nguồn quyền. */
    role: roleKey("role").notNull(),
    title: text("title").notNull(),
    /** THUỘC VỀ đúng một phòng; null với Ban giám đốc. */
    departmentId: text("department_id").references(() => departments.id),
    manageScope: manageScope("manage_scope").notNull().default("none"),
    /** Chỉ nhân viên phòng Dự Án. Chưa có bảng wards đợt này nên chưa FK. */
    wardId: text("ward_id"),
    active: boolean("active").notNull().default(true),
    /** C-01: sai 5 lần liên tiếp → khoá 15 phút, quản trị mở lại. */
    failedAttempts: smallint("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("users_department").on(t.departmentId)],
);

/** QUẢN LÝ đi đường riêng (#43) — chỉ có dòng khi manage_scope = 'listed'. */
export const userManagedDepartments = pgTable(
  "user_managed_departments",
  {
    userId: text("user_id").notNull().references(() => users.id),
    departmentId: text("department_id").notNull().references(() => departments.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] })],
);

/** Nguồn quyền THẬT (spec §1.1) — không suy ngược từ role khi kiểm quyền. */
export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: text("user_id").notNull().references(() => users.id),
    module: moduleKey("module").notNull(),
    action: actionKey("action").notNull(),
    scope: scopeKey("scope").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.module, t.action] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Lưu băm sha256, không lưu token trần — lộ bản sao DB không mạo danh được. */
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    remember: boolean("remember").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash").on(t.tokenHash)],
);

/* ── Hệ thống (mgst-db-design.md §6) ────────────────────────────────── */

/** Append-only — không có UPDATE/DELETE ở tầng app. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id").notNull().references(() => users.id),
    module: moduleKey("module").notNull(),
    action: actionKey("action").notNull(),
    /** Chuỗi người đọc được: "Nhân viên Trần Văn Hậu". */
    targetLabel: text("target_label").notNull(),
    targetTable: text("target_table"),
    targetId: text("target_id"),
    /** Chi tiết phụ (tuỳ hành động) — chỗ jsonb hiếm hoi, dữ liệu chỉ ghi không query. */
    detail: jsonb("detail"),
  },
  (t) => [
    index("audit_log_at").on(t.at.desc()),
    index("audit_log_actor").on(t.actorId, t.at.desc()),
  ],
);

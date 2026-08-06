import { randomInt } from "node:crypto";
import { hashSync } from "bcryptjs";
import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type {
  StaffAccount,
  StaffForm,
  StaffList,
  StaffOption,
  StaffQuery,
  StaffSort,
} from "@/lib/api/staff";
import { businessMonth } from "@/lib/format";
import {
  assignableRoles,
  can,
  canActOn,
  canGrant,
  clampScope,
  inVisibleScope,
  visibleDepartmentIds,
} from "@/lib/permissions";
import { SCOPELESS_ACTIONS, SCOPES, Scope, type Action, type User } from "@/lib/types";
import { forbidden, isUuid, notFound } from "./auth";
import { db, uniqueViolationOf } from "./db/client";
import {
  departments,
  kpiScores,
  sessions,
  userManagedDepartments,
  userPermissions,
  users,
} from "./db/schema";
import type { PageArgs } from "./pagination";
import { daysLeftOf, pointsExpr, staffSearchWhere, targetExpr } from "./people";
import { relationsFor } from "./users";

/**
 * P-51 · P-52 · P-53 — bản DB của src/mocks/staff.ts, cùng luật nghiệp vụ:
 * máy chủ kiểm lại bậc vai + từng ô quyền, không tin danh sách giao diện gửi lên.
 */

type UserWithDepartment = typeof users.$inferSelect & { departmentName: string | null };

async function toAccounts(rows: UserWithDepartment[]): Promise<StaffAccount[]> {
  // Quyền + phòng quản nạp MỘT lượt cho cả trang — không truy vấn từng người (N+1).
  const { permissionsOf, managedOf } = await relationsFor(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    username: r.username,
    staffCode: r.staffCode,
    phone: r.phone,
    departmentId: r.departmentId,
    departmentName: r.departmentName ?? "",
    role: r.role,
    title: r.title,
    manageScope: r.manageScope,
    managedDepartmentIds: managedOf.get(r.id) ?? [],
    wardId: r.wardId,
    active: r.active,
    permissions: permissionsOf.get(r.id) ?? [],
  }));
}

/**
 * MỘT trang của bảng nhân sự P-51 — lọc, tìm, sắp, cắt trang và đếm tóm tắt đều
 * chạy trong SQL (AGENTS.md §5.1 · §5.2).
 *
 * Chỉ đụng hai nguồn: hồ sơ nhân sự (`users` + tên phòng) và điểm/chỉ tiêu
 * (`kpi_scores` + `kpi_targets`). Bảng KHÔNG có cột đếm tài khoản / app / đơn
 * bảo hiểm, nên không câu nào ở đây chạm tới `bank_accounts` hay
 * `insurance_orders` — hai bảng lớn nhất hệ thống.
 *
 * Bản cũ kéo 500 người rồi lọc bằng JS: người thứ 501 biến mất im lặng và thẻ
 * tóm tắt đếm thiếu theo, tức SAI SỐ chứ không phải chậm.
 */
export async function staffFor(
  actor: User,
  query: Omit<StaffQuery, "page" | "sort" | "dir">,
  page: PageArgs<StaffSort>,
): Promise<StaffList> {
  // Phạm vi client xin hạ về đúng mức thật của người gọi — không tin tham số URL.
  const requested = Scope.safeParse(query.scope);
  const scope = clampScope(actor, "staff", "view-detail", requested.success ? requested.data : null);
  const visible = visibleDepartmentIds(actor, scope);

  const summaryMonth = query.summaryMonth || businessMonth();
  const target = targetExpr(summaryMonth);
  const daysLeft = daysLeftOf(summaryMonth);

  // null = không giới hạn phòng; [] = không thấy ai (người không thuộc phòng nào, phạm vi own).
  if (visible !== null && visible.length === 0)
    return {
      summaryMonth,
      daysLeft,
      summary: { active: 0, locked: 0, onTarget: 0, offTarget: 0 },
      page: { rows: [], total: 0 },
    };

  /** Phạm vi + ô lọc đơn vị. Thẻ tóm tắt đếm trên ĐÚNG tập này. */
  const inScope = and(
    visible === null ? undefined : inArray(users.departmentId, visible),
    query.departmentId ? eq(users.departmentId, query.departmentId) : undefined,
  );

  const where = and(
    inScope,
    query.status === "all" ? undefined : eq(users.active, query.status === "active"),
    // Rỗng nghĩa là lấy hết — hiểu thành "không lấy gì" thì lần đầu mở trang bảng trống trơn.
    query.roles.length > 0 ? inArray(users.role, query.roles) : undefined,
    staffSearchWhere(query.search),
  );

  const direction = page.dir === "asc" ? asc : desc;
  /**
   * Mọi kiểu sắp kết thúc bằng `id`. Trang 1 và trang 2 là hai câu hỏi riêng
   * biệt, không có khoá phụ duy nhất thì thứ tự giữa những dòng bằng nhau là
   * không xác định — người thứ 15 lần này thành thứ 16 lần sau, hiện lại ở
   * trang 2 còn người khác biến mất khỏi cả hai trang.
   */
  const orderBy = {
    // Sắp theo tên đã bỏ dấu: collate mặc định của Postgres xếp `Đặng` sau
    // `Zũng`, người dùng đọc ra là bảng sắp sai.
    name: [direction(sql`mgst_normalize(${users.fullName})`), asc(users.id)],
    role: [direction(users.role), asc(sql`mgst_normalize(${users.fullName})`), asc(users.id)],
    // Sắp theo TỈ LỆ đạt, không theo hiệu số: mốc mỗi phòng có thể khác nhau
    // nên "còn thiếu 10" của người mốc 50 nặng hơn của người mốc 200.
    kpi: [direction(sql`${pointsExpr}::float / nullif(${target}, 0)`), asc(users.id)],
  }[page.sort] as SQL[];

  const [rows, [totals], [counts]] = await Promise.all([
    db
      .select({ user: users, departmentName: departments.name, points: pointsExpr, target })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .leftJoin(
        kpiScores,
        and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, summaryMonth)),
      )
      .where(where)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.offset),
    // Phép nối `departments` phải giữ ở câu đếm — ô tìm kiếm soi cả tên đơn vị.
    db
      .select({ value: count() })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(where),
    // Tóm tắt cố ý KHÔNG áp tìm kiếm / trạng thái / chức vụ: gõ tên một người
    // không có nghĩa công ty chỉ còn một người.
    db
      .select({
        active: sql<number>`count(*) filter (where ${users.active})::int`,
        locked: sql<number>`count(*) filter (where not ${users.active})::int`,
        // Chỉ người đang làm mới có chỉ tiêu. Tính cả tài khoản đã khoá thì họ
        // vào với 0 điểm và "chưa đạt" phồng lên mà không ai thấy vì sao.
        onTarget: sql<number>`count(*) filter (where ${users.active} and ${pointsExpr} >= ${target})::int`,
      })
      .from(users)
      .leftJoin(
        kpiScores,
        and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, summaryMonth)),
      )
      .where(inScope),
  ]);

  const accounts = await toAccounts(
    rows.map((r) => ({ ...r.user, departmentName: r.departmentName })),
  );
  const scoreById = new Map(rows.map((r) => [r.user.id, r]));

  const active = counts?.active ?? 0;
  const onTarget = counts?.onTarget ?? 0;

  return {
    summaryMonth,
    daysLeft,
    summary: { active, locked: counts?.locked ?? 0, onTarget, offTarget: active - onTarget },
    page: {
      rows: accounts.map((a) => ({
        ...a,
        points: scoreById.get(a.id)?.points ?? 0,
        target: scoreById.get(a.id)?.target ?? 100,
      })),
      total: totals?.value ?? 0,
    },
  };
}

/**
 * Danh sách rút gọn, trọn bộ trong phạm vi người gọi — cho ô tra cứu và trang
 * chi tiết phòng ban. Không phân trang vì nơi gọi cần đủ danh sách để tra.
 *
 * Payload mỏng có chủ đích: đủ để tra cứu và hiện tên, KHÔNG kèm bảng quyền —
 * thứ chỉ hồ sơ một người mới cần.
 */
export async function listStaffOptions(
  actor: User,
  query: { departmentId: string; status: "active" | "all" },
): Promise<StaffOption[]> {
  const scope = clampScope(actor, "staff", "view-detail", null);
  const visible = visibleDepartmentIds(actor, scope);
  if (visible !== null && visible.length === 0) return [];

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      staffCode: users.staffCode,
      phone: users.phone,
      departmentName: departments.name,
      role: users.role,
      title: users.title,
      active: users.active,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(
      and(
        visible === null ? undefined : inArray(users.departmentId, visible),
        query.departmentId ? eq(users.departmentId, query.departmentId) : undefined,
        query.status === "active" ? eq(users.active, true) : undefined,
      ),
    )
    .orderBy(asc(sql`mgst_normalize(${users.fullName})`), asc(users.id));

  return rows.map((r) => ({ ...r, departmentName: r.departmentName ?? "" }));
}

export async function findStaff(id: string): Promise<StaffAccount | null> {
  const rows = await db
    .select({ user: users, departmentName: departments.name })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.id, id))
    .limit(1);
  if (!rows[0]) return null;

  const [account] = await toAccounts([{ ...rows[0].user, departmentName: rows[0].departmentName }]);
  return account;
}

/**
 * Cổng chung cho MỌI thao tác lên một hồ sơ nhân viên cụ thể.
 *
 * Trước đây mỗi route tự gác một kiểu: `active` và `reset-password` gọi `can()`,
 * còn `GET`/`PATCH` thì không gác gì — nên một Phó GĐ sửa được cả tài khoản ở
 * phòng mình không quản, kể cả hạ cấp Giám đốc. Gom về một chỗ để không route
 * nào quên được nữa (AGENTS.md §6).
 *
 * Ba lớp, đúng thứ tự: có quyền trên module chưa → mục tiêu có nằm trong phạm
 * vi mình nhìn thấy không → mình có đủ bậc để đụng vào người này không.
 */
export async function staffTargetFor(
  actor: User,
  id: string,
  action: Action,
): Promise<{ ok: true; staff: StaffAccount } | { ok: false; response: Response }> {
  if (!isUuid(id)) return { ok: false, response: notFound() };
  if (!can(actor, "staff", action)) return { ok: false, response: forbidden() };

  const staff = await findStaff(id);
  if (!staff) return { ok: false, response: notFound() };

  // Ngoài tầm nhìn trả 404 y hệt "không tồn tại" — 403 là xác nhận id có thật.
  if (!inVisibleScope(actor, "staff", action, staff.departmentId))
    return { ok: false, response: notFound() };

  // Trần BẬC chỉ chặn thao tác GHI. Với lượt xem thì phạm vi đã đủ, thêm bậc nữa
  // là người ngang vai không mở nổi hồ sơ của nhau dù cùng phòng.
  if (action !== "view-detail" && !canActOn(actor, staff))
    return { ok: false, response: forbidden() };

  return { ok: true, staff };
}

type SaveErrorCode =
  | "username-taken"
  | "staff-code-taken"
  | "role-too-high"
  | "permission-too-high"
  | "managed-department-too-wide";

export type SaveOutcome =
  | { ok: true; staff: StaffAccount }
  | { ok: false; code: SaveErrorCode };

export const saveError = (code: SaveErrorCode) => ({
  code,
  message:
    code === "username-taken"
      ? "Tên đăng nhập này đã có người dùng"
      : code === "staff-code-taken"
        ? "Mã nhân viên này đã có người dùng"
        : code === "role-too-high"
          ? "Bạn không gán được chức vụ cao hơn quyền của chính mình"
          : code === "managed-department-too-wide"
            ? "Bạn chỉ giao được những phòng chính mình đang quản"
            : "Có quyền bạn đang cấp vượt quá quyền của chính bạn",
});

/** Máy chủ PHẢI kiểm lại chức vụ — ẩn bớt lựa chọn trong ô chọn không phải là phân quyền. */
const checkRole = (actor: User, form: StaffForm): boolean =>
  assignableRoles(actor).includes(form.role);

/** Từng bộ ba client gửi lên phải nằm trong tầm actor được cấp (spec §10.1). */
const checkPermissions = (actor: User, form: StaffForm): boolean =>
  form.permissions.every((perm) => canGrant(actor, perm));

/**
 * Danh sách "phòng phụ trách" cũng là một trục phân quyền, không phải dữ liệu hồ sơ.
 *
 * `visibleDepartmentIds(u, 'managed')` trả thẳng danh sách này, nên mọi quyền
 * phạm vi `managed` của người được sửa nở đúng theo nó. Không chặn thì trưởng
 * phòng tự PATCH hồ sơ CHÍNH MÌNH, tích hết 15 phòng, và có tầm nhìn toàn công
 * ty — `canGrant` không thấy gì bất thường vì phạm vi vẫn đúng chữ `managed`.
 */
const checkManagedDepartments = (actor: User, form: StaffForm, action: Action): boolean => {
  if (form.manageScope !== "listed") return true;
  const allowed = visibleDepartmentIds(actor, clampScope(actor, "staff", action, null));
  // null = phạm vi toàn công ty, giao phòng nào cũng được.
  if (allowed === null) return true;
  return form.managedDepartmentIds.every((id) => allowed.includes(id));
};

/**
 * Quyền BỊ GỠ cũng phải nằm trong tầm actor, y như quyền được cấp.
 *
 * `checkPermissions` chỉ soi mảng gửi lên, mà `writeStaff` xoá sạch rồi ghi lại
 * — nên cái KHÔNG gửi lên là cái bị xoá, không ai kiểm. Giám đốc mở hồ sơ tài
 * khoản quản trị rồi bấm Lưu là `cấp quyền` biến mất, và không đường nào cấp
 * lại được vì cấp `cấp quyền` đòi phải đang có nó.
 */
const strippedPermissions = (current: StaffAccount, form: StaffForm) =>
  current.permissions.filter(
    (had) =>
      !form.permissions.some(
        (kept) =>
          kept.module === had.module &&
          kept.action === had.action &&
          // Thu hẹp phạm vi cũng là gỡ bớt quyền.
          SCOPES.indexOf(kept.scope) >= SCOPES.indexOf(had.scope),
      ),
  );

async function usernameTaken(username: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exceptId
        ? and(eq(users.username, username), ne(users.id, exceptId))
        : eq(users.username, username),
    )
    .limit(1);
  return rows.length > 0;
}

async function staffCodeTaken(staffCode: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exceptId
        ? and(eq(users.staffCode, staffCode), ne(users.id, exceptId))
        : eq(users.staffCode, staffCode),
    )
    .limit(1);
  return rows.length > 0;
}

/** Ghi user + quyền + phòng quản trong MỘT transaction — không có nửa người. */
async function writeStaff(
  id: string,
  form: StaffForm,
  mode: "create" | "update",
): Promise<void> {
  await db.transaction(async (tx) => {
    const managed = form.manageScope === "listed" ? form.managedDepartmentIds : [];

    if (mode === "create") {
      await tx.insert(users).values({
        id,
        username: form.username,
        staffCode: form.staffCode,
        // Mật khẩu khởi tạo ngẫu nhiên, không ai biết — admin cấp qua nút
        // "Đặt lại mật khẩu" (C-02), không có mật khẩu mặc định đoán được.
        passwordHash: hashSync(newPassword(), 10),
        fullName: form.fullName,
        phone: form.phone,
        role: form.role,
        title: form.title,
        departmentId: form.departmentId || null,
        manageScope: form.manageScope,
        wardId: form.wardId || null,
      });
    } else {
      await tx
        .update(users)
        .set({
          username: form.username,
          staffCode: form.staffCode,
          fullName: form.fullName,
          phone: form.phone,
          role: form.role,
          title: form.title,
          departmentId: form.departmentId || null,
          manageScope: form.manageScope,
          wardId: form.wardId || null,
          updatedAt: new Date(),
          // KHÔNG đụng `active`: khoá/mở khoá đi đường riêng — sửa hồ sơ mà
          // vô tình mở khoá người đã nghỉ việc là chuyện không được xảy ra.
        })
        .where(eq(users.id, id));
      await tx.delete(userPermissions).where(eq(userPermissions.userId, id));
      await tx.delete(userManagedDepartments).where(eq(userManagedDepartments.userId, id));
    }

    // Khoá chính của `user_permissions` là (user, module, action) nên hai dòng
    // cùng module + hành động mà khác phạm vi là vỡ 23505. Giữ phạm vi RỘNG
    // nhất cho mỗi cặp — hẹp hơn thì thừa, vì `scopeFor` vốn đã lấy rộng nhất.
    const widest = new Map<string, (typeof form.permissions)[number]>();
    for (const p of form.permissions) {
      const key = `${p.module}:${p.action}`;
      // Hành động không chia được theo phạm vi thì nắn về `company` NGAY Ở ĐÂY,
      // không tin ô chọn của giao diện: ẩn lựa chọn không phải là phân quyền, và
      // một request nặn tay vẫn gửi `own` lên được. Ghi `own` cho `manage-org`
      // là để lại một dòng trông như hẹp mà đọc trọn nhật ký công ty.
      const normalized = SCOPELESS_ACTIONS.includes(p.action)
        ? { ...p, scope: "company" as const }
        : p;
      const kept = widest.get(key);
      if (!kept || SCOPES.indexOf(normalized.scope) > SCOPES.indexOf(kept.scope))
        widest.set(key, normalized);
    }

    if (widest.size > 0)
      await tx.insert(userPermissions).values(
        [...widest.values()].map((p) => ({
          userId: id,
          module: p.module,
          action: p.action,
          scope: p.scope,
        })),
      );
    if (managed.length > 0)
      await tx
        .insert(userManagedDepartments)
        .values(managed.map((departmentId) => ({ userId: id, departmentId })));
  });
}

/**
 * Trần vai và trần quyền kiểm TRƯỚC "tên đã có người dùng".
 *
 * Ngược lại là hở oracle: người không có quyền tạo vẫn nhận `422 username-taken`
 * cho tên có thật và `role-too-high` cho tên chưa có — một request là dò được
 * từng tên đăng nhập lẫn từng mã nhân viên trong công ty.
 */
const checkCeilings = (actor: User, form: StaffForm, action: Action): SaveErrorCode | null => {
  if (!checkRole(actor, form)) return "role-too-high";
  if (!checkPermissions(actor, form)) return "permission-too-high";
  if (!checkManagedDepartments(actor, form, action)) return "managed-department-too-wide";
  return null;
};

/** Trùng khoá lúc ghi → đúng mã lỗi 422 mà client đang chờ, không phải 500. */
async function writeGuarded(
  id: string,
  form: StaffForm,
  mode: "create" | "update",
): Promise<SaveErrorCode | null> {
  try {
    await writeStaff(id, form, mode);
    return null;
  } catch (e) {
    const constraint = uniqueViolationOf(e);
    if (constraint === null) throw e;
    if (constraint.includes("staff_code")) return "staff-code-taken";
    if (constraint.includes("username")) return "username-taken";
    throw e;
  }
}

export async function createStaff(actor: User, form: StaffForm): Promise<SaveOutcome> {
  const ceiling = checkCeilings(actor, form, "create");
  if (ceiling) return { ok: false, code: ceiling };
  if (await usernameTaken(form.username)) return { ok: false, code: "username-taken" };
  if (await staffCodeTaken(form.staffCode)) return { ok: false, code: "staff-code-taken" };

  const id = crypto.randomUUID();
  const failed = await writeGuarded(id, form, "create");
  if (failed) return { ok: false, code: failed };
  return { ok: true, staff: (await findStaff(id))! };
}

export async function updateStaff(actor: User, id: string, form: StaffForm): Promise<SaveOutcome | null> {
  const current = await findStaff(id);
  if (!current) return null;
  const ceiling = checkCeilings(actor, form, "update");
  if (ceiling) return { ok: false, code: ceiling };
  if (!strippedPermissions(current, form).every((perm) => canGrant(actor, perm)))
    return { ok: false, code: "permission-too-high" };
  if (await usernameTaken(form.username, id)) return { ok: false, code: "username-taken" };
  if (await staffCodeTaken(form.staffCode, id)) return { ok: false, code: "staff-code-taken" };

  const failed = await writeGuarded(id, form, "update");
  if (failed) return { ok: false, code: failed };
  return { ok: true, staff: (await findStaff(id))! };
}

export async function setStaffActive(id: string, active: boolean): Promise<StaffAccount | null> {
  const [row] = await db
    .update(users)
    .set({ active, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) return null;
  return findStaff(id);
}

/**
 * Mật khẩu sinh ngẫu nhiên, bỏ các ký tự dễ đọc nhầm khi nhắn qua Zalo.
 *
 * Dùng `randomInt` của `node:crypto`, KHÔNG dùng `Math.random`: V8 chạy
 * xorshift128+, khôi phục được trạng thái từ một số lượng đầu ra vừa phải. Ai
 * hay đặt lại mật khẩu cho người khác sẽ gom đủ mẫu để đoán mật khẩu của những
 * lần sau, kể cả cho tài khoản họ chưa từng đụng tới.
 */
export function newPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

/** Sinh mật khẩu MỚI, trả về đúng một lần — mật khẩu cũ băm một chiều, không đọc lại được. */
export async function resetPassword(id: string): Promise<string | null> {
  const password = newPassword();
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordHash: hashSync(password, 10), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    // Đặt lại mật khẩu thường là vì tài khoản bị lộ — không cắt phiên đang sống
    // thì kẻ chiếm tài khoản vẫn vào được bằng cookie cũ tới cả năm.
    if (updated[0]) await tx.delete(sessions).where(eq(sessions.userId, id));
    return updated;
  });
  return row ? password : null;
}

/** Mở khoá đăng nhập (C-01) khi admin mở khoá một người bị khoá 15 phút. */
export async function clearLoginLock(id: string): Promise<void> {
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
}

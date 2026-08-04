import { randomInt } from "node:crypto";
import { hashSync } from "bcryptjs";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { StaffAccount, StaffForm, StaffList, StaffQuery } from "@/lib/api/staff";
import { matchesSearch } from "@/lib/format";
import {
  assignableRoles,
  can,
  canActOn,
  canGrant,
  clampScope,
  inVisibleScope,
  visibleDepartmentIds,
} from "@/lib/permissions";
import { SCOPES, Scope, type Action, type User } from "@/lib/types";
import { forbidden, isUuid, notFound } from "./auth";
import { db } from "./db/client";
import { departments, sessions, userManagedDepartments, userPermissions, users } from "./db/schema";
import { relationsFor } from "./users";

/**
 * P-51 · P-52 · P-53 — bản DB của src/mocks/staff.ts, cùng luật nghiệp vụ:
 * máy chủ kiểm lại bậc vai + từng ô quyền, không tin danh sách giao diện gửi lên.
 */

/** Trần cứng cho một công ty ~vài trăm người — chặn kéo vô hạn nếu dữ liệu phình. */
const STAFF_LIMIT = 500;

type StaffRow = typeof users.$inferSelect & { departmentName: string | null };

async function fetchStaffRows(departmentIds: string[] | null): Promise<StaffRow[]> {
  // null = không giới hạn phòng; [] = không thấy ai (người không thuộc phòng nào, phạm vi own).
  if (departmentIds !== null && departmentIds.length === 0) return [];

  const base = db
    .select({ user: users, departmentName: departments.name })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .orderBy(asc(users.fullName))
    .limit(STAFF_LIMIT);

  const rows =
    departmentIds === null
      ? await base
      : await base.where(inArray(users.departmentId, departmentIds));

  return rows.map((r) => ({ ...r.user, departmentName: r.departmentName }));
}

async function toAccounts(rows: StaffRow[]): Promise<StaffAccount[]> {
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

export async function staffFor(actor: User, query: StaffQuery): Promise<StaffList> {
  // Phạm vi client xin hạ về đúng mức thật của người gọi — không tin tham số URL.
  const requested = Scope.safeParse(query.scope);
  const scope = clampScope(actor, "staff", "view-detail", requested.success ? requested.data : null);
  const visible = visibleDepartmentIds(actor, scope);

  const rows = await fetchStaffRows(visible);

  const byDepartment = query.departmentId
    ? rows.filter((r) => r.departmentId === query.departmentId)
    : rows;

  const byStatus = byDepartment.filter((r) =>
    query.status === "all" ? true : query.status === "active" ? r.active : !r.active,
  );

  // Rỗng nghĩa là lấy hết — hiểu thành "không lấy gì" thì lần đầu mở trang bảng trống trơn.
  const byRole =
    query.roles.length > 0 ? byStatus.filter((r) => query.roles.includes(r.role)) : byStatus;

  const found = query.search
    ? byRole.filter((r) =>
        matchesSearch(`${r.fullName} ${r.username} ${r.departmentName ?? ""}`, query.search),
      )
    : byRole;

  // Tóm tắt đếm trên phạm vi + phòng, KHÔNG áp search/status/roles — cùng quy tắc với mock.
  return {
    summary: {
      active: byDepartment.filter((r) => r.active).length,
      locked: byDepartment.filter((r) => !r.active).length,
    },
    staff: await toAccounts(found),
  };
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
  if (action !== "view-detail" && !canActOn(actor, staff.role))
    return { ok: false, response: forbidden() };

  return { ok: true, staff };
}

type SaveErrorCode = "username-taken" | "staff-code-taken" | "role-too-high" | "permission-too-high";

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
          : "Có quyền bạn đang cấp vượt quá quyền của chính bạn",
});

/** Máy chủ PHẢI kiểm lại chức vụ — ẩn bớt lựa chọn trong ô chọn không phải là phân quyền. */
const checkRole = (actor: User, form: StaffForm): boolean =>
  assignableRoles(actor).includes(form.role);

/** Từng bộ ba client gửi lên phải nằm trong tầm actor được cấp (spec §10.1). */
const checkPermissions = (actor: User, form: StaffForm): boolean =>
  form.permissions.every((perm) => canGrant(actor, perm));

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

/**
 * Mã lỗi trùng khoá của Postgres. Hai lần kiểm `usernameTaken`/`staffCodeTaken`
 * ở trên là kiểm TRƯỚC KHI ghi, nên hai request song song cùng lọt qua rồi một
 * cái vỡ ở tầng DB — không bắt thì client nhận 500 thay vì 422 có mã lỗi.
 */
const UNIQUE_VIOLATION = "23505";

const uniqueViolation = (e: unknown): string | null => {
  const err = e as { code?: string; constraint?: string };
  return err?.code === UNIQUE_VIOLATION ? (err.constraint ?? "") : null;
};

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
      const kept = widest.get(key);
      if (!kept || SCOPES.indexOf(p.scope) > SCOPES.indexOf(kept.scope)) widest.set(key, p);
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
const checkCeilings = (actor: User, form: StaffForm): SaveErrorCode | null => {
  if (!checkRole(actor, form)) return "role-too-high";
  if (!checkPermissions(actor, form)) return "permission-too-high";
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
    const constraint = uniqueViolation(e);
    if (constraint === null) throw e;
    if (constraint.includes("staff_code")) return "staff-code-taken";
    if (constraint.includes("username")) return "username-taken";
    throw e;
  }
}

export async function createStaff(actor: User, form: StaffForm): Promise<SaveOutcome> {
  const ceiling = checkCeilings(actor, form);
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
  const ceiling = checkCeilings(actor, form);
  if (ceiling) return { ok: false, code: ceiling };
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

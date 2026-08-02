import { hashSync } from "bcryptjs";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { StaffAccount, StaffForm, StaffList, StaffQuery } from "@/lib/api/staff";
import { matchesSearch } from "@/lib/format";
import { assignableRoles, canGrant, clampScope, visibleDepartmentIds } from "@/lib/permissions";
import { Scope, type User } from "@/lib/types";
import { db } from "./db/client";
import { departments, userManagedDepartments, userPermissions, users } from "./db/schema";
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

export type SaveOutcome =
  | { ok: true; staff: StaffAccount }
  | { ok: false; code: "username-taken" | "role-too-high" | "permission-too-high" };

export const saveError = (code: "username-taken" | "role-too-high" | "permission-too-high") => ({
  code,
  message:
    code === "username-taken"
      ? "Tên đăng nhập này đã có người dùng"
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

    if (form.permissions.length > 0)
      await tx.insert(userPermissions).values(
        form.permissions.map((p) => ({
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

export async function createStaff(actor: User, form: StaffForm): Promise<SaveOutcome> {
  if (await usernameTaken(form.username)) return { ok: false, code: "username-taken" };
  if (!checkRole(actor, form)) return { ok: false, code: "role-too-high" };
  if (!checkPermissions(actor, form)) return { ok: false, code: "permission-too-high" };

  const id = crypto.randomUUID();
  await writeStaff(id, form, "create");
  return { ok: true, staff: (await findStaff(id))! };
}

export async function updateStaff(actor: User, id: string, form: StaffForm): Promise<SaveOutcome | null> {
  const current = await findStaff(id);
  if (!current) return null;
  if (await usernameTaken(form.username, id)) return { ok: false, code: "username-taken" };
  if (!checkRole(actor, form)) return { ok: false, code: "role-too-high" };
  if (!checkPermissions(actor, form)) return { ok: false, code: "permission-too-high" };

  await writeStaff(id, form, "update");
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

/** Mật khẩu sinh ngẫu nhiên, bỏ các ký tự dễ đọc nhầm khi nhắn qua Zalo. */
export function newPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(
    { length: 10 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

/** Sinh mật khẩu MỚI, trả về đúng một lần — mật khẩu cũ băm một chiều, không đọc lại được. */
export async function resetPassword(id: string): Promise<string | null> {
  const password = newPassword();
  const [row] = await db
    .update(users)
    .set({ passwordHash: hashSync(password, 10), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return row ? password : null;
}

/** Mở khoá đăng nhập (C-01) khi admin mở khoá một người bị khoá 15 phút. */
export async function clearLoginLock(id: string): Promise<void> {
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
}

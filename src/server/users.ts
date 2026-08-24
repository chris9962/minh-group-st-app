import { eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { userManagedBanks, userManagedDepartments, userPermissions, users } from "./db/schema";
import type { Permission, User } from "@/lib/types";

/**
 * Dựng đối tượng `User` (đúng schema zod ở lib/types) từ 3 bảng.
 * Dùng chung cho phiên đăng nhập lẫn danh sách nhân viên — một cách ghép duy nhất.
 */

type UserRow = typeof users.$inferSelect;

export function toUser(
  row: UserRow,
  permissions: Permission[],
  managedDepartmentIds: string[],
  managedBankIds: string[] = [],
): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role,
    departmentId: row.departmentId,
    managedDepartmentIds,
    manageScope: row.manageScope,
    managedBankIds,
    bankScope: row.bankScope,
    title: row.title,
    permissions,
    active: row.active,
  };
}

/** Nạp quyền + phòng quản cho MỘT LƯỢT nhiều người — tránh N+1 khi trả danh sách. */
export async function relationsFor(userIds: string[]): Promise<{
  permissionsOf: Map<string, Permission[]>;
  managedOf: Map<string, string[]>;
  managedBanksOf: Map<string, string[]>;
}> {
  const permissionsOf = new Map<string, Permission[]>();
  const managedOf = new Map<string, string[]>();
  const managedBanksOf = new Map<string, string[]>();
  if (userIds.length === 0) return { permissionsOf, managedOf, managedBanksOf };

  const [perms, managed, managedBanks] = await Promise.all([
    db.select().from(userPermissions).where(inArray(userPermissions.userId, userIds)),
    db
      .select()
      .from(userManagedDepartments)
      .where(inArray(userManagedDepartments.userId, userIds)),
    db.select().from(userManagedBanks).where(inArray(userManagedBanks.userId, userIds)),
  ]);

  for (const p of perms) {
    const list = permissionsOf.get(p.userId) ?? [];
    list.push({ module: p.module, action: p.action, scope: p.scope });
    permissionsOf.set(p.userId, list);
  }
  for (const m of managed) {
    const list = managedOf.get(m.userId) ?? [];
    list.push(m.departmentId);
    managedOf.set(m.userId, list);
  }
  for (const b of managedBanks) {
    const list = managedBanksOf.get(b.userId) ?? [];
    list.push(b.bankId);
    managedBanksOf.set(b.userId, list);
  }
  return { permissionsOf, managedOf, managedBanksOf };
}

export async function loadUser(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;

  const { permissionsOf, managedOf, managedBanksOf } = await relationsFor([row.id]);
  return toUser(
    row,
    permissionsOf.get(row.id) ?? [],
    managedOf.get(row.id) ?? [],
    managedBanksOf.get(row.id) ?? [],
  );
}

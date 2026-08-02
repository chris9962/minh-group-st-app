import { hashSync } from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ROLE_PERMISSIONS } from "../src/lib/roles";
import type { Permission } from "../src/lib/types";
import { departments as seedDepartments, mockUsers } from "../src/mocks/data";
import { ALL } from "../src/mocks/people";
import * as schema from "../src/server/db/schema";

/**
 * Seed đọc THẲNG từ src/mocks — một nguồn dữ liệu demo duy nhất, không chép tay.
 * Nhân sự dựng đúng như store của src/mocks/staff.ts: 12 người danh sách P-51
 * (ai trùng tên tài khoản đăng nhập thì lấy tài khoản đó, giữ id P-51) + các
 * tài khoản còn lại (ban giám đốc, kế toán, quản trị…) = 23 dòng.
 *
 * Idempotent: onConflictDoNothing theo khoá chính — chạy lại không nhân đôi.
 */

/** Mật khẩu demo chung — như mock. Băm sẵn MỘT lần: bcrypt cost 10 mất ~80ms/lần, 23 lần thì chậm vô ích. */
const DEMO_PASSWORD_HASH = hashSync("12345678", 10);

type SeedUser = {
  id: string;
  username: string;
  fullName: string;
  phone: string;
  role: (typeof mockUsers)[number]["role"];
  title: string;
  departmentId: string | null;
  manageScope: (typeof mockUsers)[number]["manageScope"];
  managedDepartmentIds: string[];
  wardId: string | null;
  active: boolean;
  permissions: Permission[];
};

function buildUsers(): SeedUser[] {
  const departmentIdByName = (name: string): string | null =>
    seedDepartments.find((d) => d.name === name)?.id ?? null;

  // Nhánh 1 — 12 người của danh sách P-51, cùng quy tắc với mocks/staff.ts.
  const fromPeople = ALL.map((p, i): SeedUser => {
    const account = mockUsers.find((u) => u.fullName === p.fullName);
    if (account) {
      const { password: _omit, ...rest } = account;
      void _omit;
      return { ...rest, id: p.id, phone: "0900000000" };
    }
    return {
      id: p.id,
      username: `nv${String(i + 1).padStart(2, "0")}`,
      fullName: p.fullName,
      phone: "0900000000",
      role: "staff",
      title: "Nhân viên kinh doanh",
      departmentId: departmentIdByName(p.departmentName),
      manageScope: "none",
      managedDepartmentIds: [],
      wardId: null,
      // Giữ đúng nhịp khoá của mock (i % 7): dòng người bị khoá phải có mặt
      // để P-51 lọc "đã khoá" có dữ liệu mà thử.
      active: i % 7 !== 0,
      permissions: ROLE_PERMISSIONS.staff,
    };
  });

  // Nhánh 2 — tài khoản không nằm trong P-51: ban giám đốc, kế toán, quản trị…
  const fromAccounts = mockUsers
    .filter((u) => !ALL.some((p) => p.fullName === u.fullName))
    .map((u): SeedUser => {
      const { password: _omit, ...rest } = u;
      void _omit;
      return { ...rest, phone: "0900000000" };
    });

  return [...fromPeople, ...fromAccounts];
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  await db
    .insert(schema.departments)
    .values(seedDepartments.map((d) => ({ id: d.id, name: d.name, active: d.active })))
    .onConflictDoNothing();

  const users = buildUsers();

  await db
    .insert(schema.users)
    .values(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        passwordHash: DEMO_PASSWORD_HASH,
        fullName: u.fullName,
        phone: u.phone,
        role: u.role,
        title: u.title,
        departmentId: u.departmentId,
        manageScope: u.manageScope,
        wardId: u.wardId,
        active: u.active,
      })),
    )
    .onConflictDoNothing();

  const managedRows = users.flatMap((u) =>
    u.manageScope === "listed"
      ? u.managedDepartmentIds.map((departmentId) => ({ userId: u.id, departmentId }))
      : [],
  );
  if (managedRows.length > 0)
    await db.insert(schema.userManagedDepartments).values(managedRows).onConflictDoNothing();

  const permissionRows = users.flatMap((u) =>
    u.permissions.map((p) => ({
      userId: u.id,
      module: p.module,
      action: p.action,
      scope: p.scope,
    })),
  );
  await db.insert(schema.userPermissions).values(permissionRows).onConflictDoNothing();

  await pool.end();
  console.log(`Seed xong: ${seedDepartments.length} phòng, ${users.length} nhân sự.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { and, asc, count, eq, sql } from "drizzle-orm";
import { removeDiacritics } from "@/lib/format";
import {
  ORG_ERROR,
  type DepartmentDetail,
  type DepartmentList,
  type DepartmentRow,
  type OrgErrorCode,
} from "@/lib/api/org";
import { db } from "./db/client";
import { departments, userManagedDepartments, users } from "./db/schema";

/**
 * P-91 · Phòng ban — bản DB của src/mocks/org.ts, cùng luật:
 * không xoá cứng, không ngừng phòng còn người, so trùng tên bỏ dấu.
 */

const sameNameKey = (name: string): string =>
  removeDiacritics(name).trim().toLowerCase();

/** MỘT câu GROUP BY cho headcount mọi phòng — không đếm từng phòng một (N+1). */
async function rowsWithHeadcount(): Promise<DepartmentRow[]> {
  const rows = await db
    .select({
      id: departments.id,
      name: departments.name,
      active: departments.active,
      headcount: count(users.id),
    })
    .from(departments)
    .leftJoin(users, eq(users.departmentId, departments.id))
    .groupBy(departments.id)
    .orderBy(asc(departments.name));

  return rows.map((r) => ({ ...r, headcount: Number(r.headcount) }));
}

async function headcountOf(id: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.departmentId, id));
  return Number(row?.n ?? 0);
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  // So bỏ dấu + thường hoá phải làm cùng một cách ở cả hai phía — kéo tên về
  // so bằng chính hàm của lib/format thay vì đoán lại collation trong SQL.
  const all = await db.select({ id: departments.id, name: departments.name }).from(departments);
  const key = sameNameKey(name);
  return all.some((d) => d.id !== exceptId && sameNameKey(d.name) === key);
}

export async function departmentsFor(search: string): Promise<DepartmentList> {
  const rows = await rowsWithHeadcount();

  // Tìm kiếm KHÔNG áp lên phần tóm tắt — gõ tên một phòng không có nghĩa là
  // công ty chỉ còn một phòng.
  const key = sameNameKey(search);
  const found = search ? rows.filter((d) => sameNameKey(d.name).includes(key)) : rows;

  return {
    summary: {
      total: rows.length,
      active: rows.filter((d) => d.active).length,
      stopped: rows.filter((d) => !d.active).length,
    },
    departments: found,
  };
}

export async function activeDepartments() {
  return db
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .where(eq(departments.active, true))
    .orderBy(asc(departments.name));
}

export type OrgOutcome =
  | { ok: true; department: DepartmentRow }
  | { ok: false; code: OrgErrorCode };

/** Cùng lời nhắn với bản mock — FE đã hiện đúng các câu này. */
export const orgError = (code: OrgErrorCode) => ({
  code,
  message:
    code === ORG_ERROR.NAME_TAKEN
      ? "Đã có phòng tên này"
      : "Phòng này vẫn còn người — chuyển họ sang phòng khác trước",
});

export async function createDepartment(name: string): Promise<OrgOutcome> {
  if (await nameTaken(name)) return { ok: false, code: ORG_ERROR.NAME_TAKEN };

  const [row] = await db
    .insert(departments)
    .values({ id: crypto.randomUUID(), name })
    .returning();
  return { ok: true, department: { id: row.id, name: row.name, active: row.active, headcount: 0 } };
}

export async function renameDepartment(id: string, name: string): Promise<OrgOutcome | null> {
  const [current] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!current) return null;
  if (await nameTaken(name, id)) return { ok: false, code: ORG_ERROR.NAME_TAKEN };

  // Giữ nguyên `active`: ngừng / mở lại đi bằng đường riêng.
  const [row] = await db
    .update(departments)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(departments.id, id))
    .returning();
  return {
    ok: true,
    department: { id: row.id, name: row.name, active: row.active, headcount: await headcountOf(id) },
  };
}

/** Máy chủ PHẢI kiểm lại số người — vô hiệu nút ở giao diện không phải là phân quyền. */
export async function setDepartmentActive(
  id: string,
  active: boolean,
): Promise<OrgOutcome | null> {
  const [current] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!current) return null;

  const headcount = await headcountOf(id);
  // Chỉ chặn lúc NGỪNG — phòng còn người càng phải mở lại được.
  if (!active && headcount > 0) return { ok: false, code: ORG_ERROR.NOT_EMPTY };

  const [row] = await db
    .update(departments)
    .set({ active, updatedAt: sql`now()` })
    .where(eq(departments.id, id))
    .returning();
  return { ok: true, department: { id: row.id, name: row.name, active: row.active, headcount } };
}

/**
 * Người quản lý một phòng — chỉ tính cấp Phó GĐ trở lên; không ai quản thì
 * hiện Giám đốc theo mặc định (quyết định #44 — company không liệt kê từng phòng).
 */
export async function departmentDetailFor(id: string): Promise<DepartmentDetail | null> {
  const [department] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!department) return null;

  const listed = await db
    .select({ id: users.id, fullName: users.fullName, title: users.title })
    .from(userManagedDepartments)
    .innerJoin(users, eq(users.id, userManagedDepartments.userId))
    .where(
      and(
        eq(userManagedDepartments.departmentId, id),
        eq(users.role, "deputy-director"),
        eq(users.manageScope, "listed"),
      ),
    );

  const managedByDefault = listed.length === 0;
  const managers = managedByDefault
    ? await db
        .select({ id: users.id, fullName: users.fullName, title: users.title })
        .from(users)
        .where(eq(users.role, "director"))
    : listed;

  return {
    department: {
      id: department.id,
      name: department.name,
      active: department.active,
      headcount: await headcountOf(id),
    },
    managers,
    managedByDefault,
  };
}

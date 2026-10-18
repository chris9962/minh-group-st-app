import { and, asc, count, desc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { DepartmentPointsList, DepartmentPointsSort } from "@/lib/api/departmentPoints";
import { businessMonth } from "@/lib/format";
import type { User } from "@/lib/types";
import { closedMonthMessage, isMonthClosed } from "./closedMonths";
import { db } from "./db/client";
import {
  departmentPointExclusions,
  departments,
  kpiScores,
  staffRoster,
  users,
} from "./db/schema";
import type { PageArgs } from "./pagination";
import { pointsExpr, staffSearchWhere } from "./people";

/**
 * P-54 · Loại nhân viên khỏi điểm phòng theo tháng (chốt 2026-10-18). Các phép
 * cộng điểm phòng đọc dấu này qua `excludedStaffIn` và `departmentPointsFrom`
 * ở `kpi.ts`.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `2026-10` → `tháng 10/2026`, cho nhật ký. */
export const monthText = (month: string): string =>
  `tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

export async function departmentPointsList(
  query: { month: string; departmentId: string; search: string },
  page: PageArgs<DepartmentPointsSort>,
): Promise<DepartmentPointsList> {
  const month = MONTH.test(query.month) && query.month <= businessMonth() ? query.month : businessMonth();
  const points = pointsExpr(month);

  const inMonth = and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, month));
  const excludedJoin = and(
    eq(departmentPointExclusions.userId, users.id),
    eq(departmentPointExclusions.yearMonth, month),
  );
  // Người đã khoá mà không có điểm trong tháng thì không ảnh hưởng điểm phòng, ẩn cho bảng gọn.
  const where = and(
    eq(staffRoster.role, "staff"),
    eq(departments.type, "sales"),
    query.departmentId ? eq(staffRoster.departmentId, query.departmentId) : undefined,
    or(eq(staffRoster.active, true), sql`${points} <> 0`),
    staffSearchWhere(query.search),
  );

  const direction = page.dir === "asc" ? asc : desc;
  const byName = asc(sql`mgst_normalize(${users.fullName})`);
  const orderBy = {
    name: [direction(sql`mgst_normalize(${users.fullName})`), asc(users.id)],
    points: [direction(points), byName, asc(users.id)],
    excluded: [direction(isNotNull(departmentPointExclusions.userId)), direction(points), byName, asc(users.id)],
  }[page.sort] as SQL[];

  const [rows, [total], closed, salesDepartments] = await Promise.all([
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        staffCode: users.staffCode,
        departmentName: departments.name,
        points,
        note: departmentPointExclusions.note,
        byName: departmentPointExclusions.createdByName,
        at: departmentPointExclusions.createdAt,
      })
      .from(users)
      .innerJoin(staffRoster, inMonth)
      .innerJoin(departments, eq(departments.id, staffRoster.departmentId))
      .leftJoin(kpiScores, and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, month)))
      .leftJoin(departmentPointExclusions, excludedJoin)
      .where(where)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ value: count() })
      .from(users)
      .innerJoin(staffRoster, inMonth)
      .innerJoin(departments, eq(departments.id, staffRoster.departmentId))
      .leftJoin(kpiScores, and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, month)))
      .where(where),
    isMonthClosed(month),
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.active, true), eq(departments.type, "sales")))
      .orderBy(asc(departments.name)),
  ]);

  return {
    month,
    monthClosed: closed,
    departments: salesDepartments,
    page: {
      rows: rows.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        staffCode: r.staffCode,
        departmentName: r.departmentName,
        points: Math.round(r.points * 100) / 100,
        exclusion: r.at ? { note: r.note ?? "", byName: r.byName ?? "", at: r.at } : null,
      })),
      total: total?.value ?? 0,
    },
  };
}

type Outcome = { ok: true; fullName: string } | { ok: false; message: string } | null;

/**
 * Nhân viên `userId` ở tháng `month`, nếu đánh dấu được. `null` khi người đó
 * không có dòng nhân sự của tháng; `ok: false` khi tháng đã chốt lương hoặc
 * người đó không phải Nhân viên phòng kinh doanh trong tháng đó.
 */
async function targetOf(userId: string, month: string): Promise<Outcome> {
  if (!MONTH.test(month) || month > businessMonth()) return null;
  const [row] = await db
    .select({ fullName: users.fullName, role: staffRoster.role, departmentType: departments.type })
    .from(users)
    .innerJoin(staffRoster, and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, month)))
    .leftJoin(departments, eq(departments.id, staffRoster.departmentId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  if (await isMonthClosed(month)) return { ok: false, message: closedMonthMessage(month) };
  if (row.role !== "staff" || row.departmentType !== "sales")
    return { ok: false, message: "Chỉ loại được người có chức vụ Nhân viên ở phòng kinh doanh." };
  return { ok: true, fullName: row.fullName };
}

/** Đánh dấu lại người đã bị loại thì chỉ thay lý do, người và lúc đánh dấu. */
export async function excludeFromDepartmentPoints(
  actor: User,
  userId: string,
  month: string,
  note: string,
): Promise<Outcome> {
  const target = await targetOf(userId, month);
  if (!target?.ok) return target;
  const values = { note, createdBy: actor.id, createdByName: actor.fullName, createdAt: new Date() };
  await db
    .insert(departmentPointExclusions)
    .values({ userId, yearMonth: month, ...values })
    .onConflictDoUpdate({
      target: [departmentPointExclusions.userId, departmentPointExclusions.yearMonth],
      set: values,
    });
  return target;
}

export async function includeInDepartmentPoints(userId: string, month: string): Promise<Outcome> {
  const target = await targetOf(userId, month);
  if (!target?.ok) return target;
  const deleted = await db
    .delete(departmentPointExclusions)
    .where(
      and(eq(departmentPointExclusions.userId, userId), eq(departmentPointExclusions.yearMonth, month)),
    )
    .returning({ userId: departmentPointExclusions.userId });
  return deleted.length > 0 ? target : null;
}

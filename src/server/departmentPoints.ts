import { and, eq } from "drizzle-orm";
import { businessMonth } from "@/lib/format";
import type { User } from "@/lib/types";
import { closedMonthMessage, isMonthClosed } from "./closedMonths";
import { db } from "./db/client";
import { departmentPointExclusions, departments, staffRoster, users } from "./db/schema";

/**
 * Loại nhân viên khỏi điểm phòng theo tháng (chốt 2026-10-18), bấm ở trang
 * chi tiết phòng. Các phép cộng điểm phòng đọc dấu này qua `excludedStaffIn`
 * và `departmentPointsFrom` ở `kpi.ts`.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `2026-10` → `tháng 10/2026`, cho nhật ký. */
export const monthText = (month: string): string =>
  `tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

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

/** Khôi phục chỉ đòi tháng còn mở, không đòi người đó còn là Nhân viên phòng kinh doanh. */
export async function includeInDepartmentPoints(userId: string, month: string): Promise<Outcome> {
  if (!MONTH.test(month)) return null;
  if (await isMonthClosed(month)) return { ok: false, message: closedMonthMessage(month) };
  const [deleted] = await db
    .delete(departmentPointExclusions)
    .where(
      and(eq(departmentPointExclusions.userId, userId), eq(departmentPointExclusions.yearMonth, month)),
    )
    .returning({ userId: departmentPointExclusions.userId });
  if (!deleted) return null;
  const [user] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId));
  return { ok: true, fullName: user?.fullName ?? "" };
}

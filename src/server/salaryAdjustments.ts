import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  SalaryAdjustment,
  SalaryAdjustmentForm,
  SalaryAdjustmentKind,
} from "@/lib/api/salaryAdjustments";
import { businessDay } from "@/lib/format";
import type { User } from "@/lib/types";
import { isMonthClosed } from "./closedMonths";
import { db } from "./db/client";
import { salaryAdjustments, salaryAdvanceRequests, users } from "./db/schema";

/**
 * Các lần ứng, thưởng, trừ đang có trong bảng của từng người, cũ trước mới sau.
 * Tháng đã chốt lương đọc bản chụp ở `salary_snapshots`, xem `salaryForUsers`.
 */
export async function liveSalaryAdjustments(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SalaryAdjustment[]>> {
  const out = new Map<string, SalaryAdjustment[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      id: salaryAdjustments.id,
      userId: salaryAdjustments.userId,
      kind: salaryAdjustments.kind,
      amount: salaryAdjustments.amount,
      note: salaryAdjustments.note,
      createdAt: salaryAdjustments.createdAt,
      createdByName: users.fullName,
      advanceId: salaryAdvanceRequests.id,
    })
    .from(salaryAdjustments)
    .innerJoin(users, eq(users.id, salaryAdjustments.createdBy))
    .leftJoin(salaryAdvanceRequests, eq(salaryAdvanceRequests.adjustmentId, salaryAdjustments.id))
    .where(and(eq(salaryAdjustments.yearMonth, yearMonth), inArray(salaryAdjustments.userId, userIds)))
    .orderBy(asc(salaryAdjustments.createdAt), asc(salaryAdjustments.id));
  for (const { userId, createdAt, advanceId, ...r } of rows)
    out.get(userId)?.push({ ...r, date: businessDay(createdAt), linked: advanceId !== null });
  return out;
}

type Target = { id: string; fullName: string };

async function staffOf(id: string): Promise<Target | null> {
  const [row] = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

/** `closed` khi tháng đã chốt lương: số đã chốt là số đã trả, không ghi thêm. */
export async function createSalaryAdjustment(
  actor: User,
  userId: string,
  form: SalaryAdjustmentForm,
): Promise<{ staff: Target; row: SalaryAdjustment } | "closed" | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;
  if (await isMonthClosed(form.month)) return "closed";

  const [inserted] = await db
    .insert(salaryAdjustments)
    .values({
      userId,
      yearMonth: form.month,
      kind: form.kind,
      amount: form.amount,
      note: form.note,
      createdBy: actor.id,
    })
    .returning();
  return {
    staff,
    row: {
      id: inserted.id,
      kind: inserted.kind,
      amount: inserted.amount,
      note: inserted.note,
      date: businessDay(inserted.createdAt),
      createdByName: actor.fullName,
    },
  };
}

export async function deleteSalaryAdjustment(
  userId: string,
  adjustmentId: string,
): Promise<{ staff: Target; kind: SalaryAdjustmentKind; amount: number; month: string } | "closed" | "linked" | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;
  const [row] = await db
    .select({ yearMonth: salaryAdjustments.yearMonth, advanceId: salaryAdvanceRequests.id })
    .from(salaryAdjustments)
    .leftJoin(salaryAdvanceRequests, eq(salaryAdvanceRequests.adjustmentId, salaryAdjustments.id))
    .where(and(eq(salaryAdjustments.id, adjustmentId), eq(salaryAdjustments.userId, userId)))
    .limit(1);
  if (!row) return null;
  if (await isMonthClosed(row.yearMonth)) return "closed";
  if (row.advanceId) return "linked";

  const [deleted] = await db
    .delete(salaryAdjustments)
    .where(and(eq(salaryAdjustments.id, adjustmentId), eq(salaryAdjustments.userId, userId)))
    .returning({ kind: salaryAdjustments.kind, amount: salaryAdjustments.amount });
  if (!deleted) return null;
  return { staff, ...deleted, month: row.yearMonth };
}

import { and, eq } from "drizzle-orm";
import type { KpiAdjustment, KpiAdjustmentForm } from "@/lib/api/person";
import { businessDay, businessMonth } from "@/lib/format";
import type { User } from "@/lib/types";
import { isMonthClosed, lockSalaryMonth } from "./closedMonths";
import { db } from "./db/client";
import { kpiAdjustments, users } from "./db/schema";

/**
 * Điểm cộng KPI tay theo tháng — ghi từ hồ sơ nhân viên P-52, quyền
 * `system:adjust-kpi`.
 *
 * Ghi, sửa, xoá được ở mọi tháng CHƯA CHỐT LƯƠNG, tính tới tháng hiện tại
 * (chủ dự án chốt 2026-11-17). Tháng đã chốt lương thì số đã trả, đứng yên.
 */

type Target = { id: string; fullName: string };

async function staffOf(id: string): Promise<Target | null> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

const toRow = (
  r: { id: string; points: string; reason: string; createdAt: Date },
  createdByName: string,
): KpiAdjustment => ({
  id: r.id,
  points: Number(r.points),
  reason: r.reason,
  date: businessDay(r.createdAt),
  createdByName,
  vpaAccountCount: 0,
});

export async function createAdjustment(
  actor: User,
  userId: string,
  yearMonth: string,
  form: KpiAdjustmentForm,
): Promise<{ staff: Target; row: KpiAdjustment } | "closed" | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;
  if (yearMonth > businessMonth()) return "closed";

  return db.transaction(async (tx) => {
    await lockSalaryMonth(tx, yearMonth);
    if (await isMonthClosed(yearMonth, tx)) return "closed";

    const [inserted] = await tx
      .insert(kpiAdjustments)
      .values({
        userId,
        yearMonth,
        points: form.points.toFixed(2),
        reason: form.reason,
        createdBy: actor.id,
      })
      .returning({
        id: kpiAdjustments.id,
        points: kpiAdjustments.points,
        reason: kpiAdjustments.reason,
        createdAt: kpiAdjustments.createdAt,
      });

    return { staff, row: toRow(inserted, actor.fullName) };
  });
}

async function monthOf(userId: string, adjustmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ yearMonth: kpiAdjustments.yearMonth })
    .from(kpiAdjustments)
    .where(and(eq(kpiAdjustments.id, adjustmentId), eq(kpiAdjustments.userId, userId)))
    .limit(1);
  return row?.yearMonth ?? null;
}

export async function updateAdjustment(
  actor: User,
  userId: string,
  adjustmentId: string,
  form: KpiAdjustmentForm,
): Promise<{ staff: Target; row: KpiAdjustment; yearMonth: string } | "closed" | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;
  const yearMonth = await monthOf(userId, adjustmentId);
  if (!yearMonth) return null;

  return db.transaction(async (tx) => {
    await lockSalaryMonth(tx, yearMonth);
    if (await isMonthClosed(yearMonth, tx)) return "closed";

    const [updated] = await tx
      .update(kpiAdjustments)
      .set({ points: form.points.toFixed(2), reason: form.reason })
      .where(and(eq(kpiAdjustments.id, adjustmentId), eq(kpiAdjustments.userId, userId)))
      .returning({
        id: kpiAdjustments.id,
        points: kpiAdjustments.points,
        reason: kpiAdjustments.reason,
        createdAt: kpiAdjustments.createdAt,
      });
    if (!updated) return null;

    return { staff, row: toRow(updated, actor.fullName), yearMonth };
  });
}

export async function deleteAdjustment(
  userId: string,
  adjustmentId: string,
): Promise<{ staff: Target; points: number; yearMonth: string } | "closed" | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;
  const yearMonth = await monthOf(userId, adjustmentId);
  if (!yearMonth) return null;

  return db.transaction(async (tx) => {
    await lockSalaryMonth(tx, yearMonth);
    if (await isMonthClosed(yearMonth, tx)) return "closed";

    const [deleted] = await tx
      .delete(kpiAdjustments)
      .where(and(eq(kpiAdjustments.id, adjustmentId), eq(kpiAdjustments.userId, userId)))
      .returning({ points: kpiAdjustments.points });
    if (!deleted) return null;

    return { staff, points: Number(deleted.points), yearMonth };
  });
}

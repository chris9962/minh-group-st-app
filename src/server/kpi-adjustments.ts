import { and, eq } from "drizzle-orm";
import type { KpiAdjustment, KpiAdjustmentForm } from "@/lib/api/person";
import { businessDay, businessMonth } from "@/lib/format";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import { kpiAdjustments, users } from "./db/schema";

/**
 * Điểm cộng KPI tay theo tháng — ghi từ hồ sơ nhân viên P-52, quyền
 * `system:adjust-kpi`.
 *
 * Mọi thao tác khoá vào THÁNG HIỆN TẠI: P-52 chỉ hiện KPI của tháng hiện tại,
 * và điểm tháng đã qua coi như chốt sổ — sửa dòng cũ là viết lại quá khứ mà
 * không màn nào hiện ra cho ai thấy.
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
});

export async function createAdjustment(
  actor: User,
  userId: string,
  form: KpiAdjustmentForm,
): Promise<{ staff: Target; row: KpiAdjustment } | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;

  const [inserted] = await db
    .insert(kpiAdjustments)
    .values({
      userId,
      yearMonth: businessMonth(),
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
}

/** Chỉ sửa được dòng của THÁNG HIỆN TẠI — dòng tháng cũ trả `null` như không có. */
export async function updateAdjustment(
  actor: User,
  userId: string,
  adjustmentId: string,
  form: KpiAdjustmentForm,
): Promise<{ staff: Target; row: KpiAdjustment } | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;

  const [updated] = await db
    .update(kpiAdjustments)
    .set({ points: form.points.toFixed(2), reason: form.reason })
    .where(
      and(
        eq(kpiAdjustments.id, adjustmentId),
        eq(kpiAdjustments.userId, userId),
        eq(kpiAdjustments.yearMonth, businessMonth()),
      ),
    )
    .returning({
      id: kpiAdjustments.id,
      points: kpiAdjustments.points,
      reason: kpiAdjustments.reason,
      createdAt: kpiAdjustments.createdAt,
    });
  if (!updated) return null;

  return { staff, row: toRow(updated, actor.fullName) };
}

/** Cùng luật với sửa: chỉ xoá được dòng của tháng hiện tại. */
export async function deleteAdjustment(
  userId: string,
  adjustmentId: string,
): Promise<{ staff: Target; points: number } | null> {
  const staff = await staffOf(userId);
  if (!staff) return null;

  const [deleted] = await db
    .delete(kpiAdjustments)
    .where(
      and(
        eq(kpiAdjustments.id, adjustmentId),
        eq(kpiAdjustments.userId, userId),
        eq(kpiAdjustments.yearMonth, businessMonth()),
      ),
    )
    .returning({ points: kpiAdjustments.points });
  if (!deleted) return null;

  return { staff, points: Number(deleted.points) };
}

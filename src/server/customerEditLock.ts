import { and, count, desc, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import type { CustomerEditLock } from "@/lib/api/ops";
import { SOCIAL_DEPARTMENT_CODE } from "@/lib/api/staff";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";
import { db } from "./db/client";
import { customerEditRevocations, departments, userPermissions, users } from "./db/schema";

/** Hai phòng giữ quyền sửa khách khi bấm thu hồi (chốt 2026-10-08). So bằng MÃ vì P-91 cho đổi tên phòng. */
const KEPT_DEPARTMENT_CODES = ["PHONG-ATM-CONG-DONG", SOCIAL_DEPARTMENT_CODE];

const isCustomerUpdate = and(
  eq(userPermissions.module, "customer"),
  eq(userPermissions.action, "update"),
);

export async function customerEditLock(): Promise<CustomerEditLock> {
  const [{ revoked }] = await db.select({ revoked: count() }).from(customerEditRevocations);
  const [last] = await db
    .select({ at: customerEditRevocations.revokedAt, by: users.fullName })
    .from(customerEditRevocations)
    .innerJoin(users, eq(users.id, customerEditRevocations.revokedBy))
    .orderBy(desc(customerEditRevocations.revokedAt))
    .limit(1);
  return { revoked, revokedAt: last?.at.toISOString() ?? "", revokedBy: last?.by ?? "" };
}

/** Rút `customer:update` của mọi Nhân viên đang làm, trừ hai phòng ở trên. Trả số người bị rút. */
export async function revokeCustomerEdit(actor: User): Promise<number> {
  const revoked = await db.transaction(async (tx) => {
    const targets = await tx
      .select({ userId: userPermissions.userId, scope: userPermissions.scope })
      .from(userPermissions)
      .innerJoin(users, eq(users.id, userPermissions.userId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(
        and(
          isCustomerUpdate,
          eq(users.role, "staff"),
          eq(users.active, true),
          or(isNull(departments.code), notInArray(departments.code, KEPT_DEPARTMENT_CODES)),
        ),
      );
    if (targets.length === 0) return 0;

    // Người đã có dòng từ lượt thu hồi trước thì giữ phạm vi ghi lúc đó.
    await tx
      .insert(customerEditRevocations)
      .values(targets.map((t) => ({ ...t, revokedBy: actor.id })))
      .onConflictDoNothing();
    await tx.delete(userPermissions).where(
      and(
        isCustomerUpdate,
        inArray(
          userPermissions.userId,
          targets.map((t) => t.userId),
        ),
      ),
    );
    return targets.length;
  });

  if (revoked > 0)
    await logAudit(actor, {
      module: "customer",
      action: "update",
      targetLabel: `Thu hồi quyền sửa khách của ${revoked} nhân viên`,
    });
  return revoked;
}

/** Cấp lại `customer:update` cho đúng những người đã bị rút, theo phạm vi cũ. Trả số người được cấp lại. */
export async function restoreCustomerEdit(actor: User): Promise<number> {
  const restored = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(customerEditRevocations)
      .returning({ userId: customerEditRevocations.userId, scope: customerEditRevocations.scope });
    if (rows.length === 0) return 0;

    // Ai đã được cấp tay trong lúc bị thu hồi thì giữ phạm vi đang có.
    await tx
      .insert(userPermissions)
      .values(rows.map((r) => ({ ...r, module: "customer" as const, action: "update" as const })))
      .onConflictDoNothing();
    return rows.length;
  });

  if (restored > 0)
    await logAudit(actor, {
      module: "customer",
      action: "update",
      targetLabel: `Cấp lại quyền sửa khách cho ${restored} nhân viên`,
    });
  return restored;
}

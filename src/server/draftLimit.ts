import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { MAX_DRAFTS_PER_STAFF_BY_TYPE } from "@/lib/api/bankAccounts";
import type { DraftLimits, DraftLimitSetting } from "@/lib/api/ops";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";
import { db } from "./db/client";
import { departments, draftLimitDefault, draftLimitOverrides, users } from "./db/schema";

/**
 * Trần bản nháp mỗi nhân viên giữ cùng lúc ở một ngân hàng, theo loại tài khoản:
 * mức mặc định cộng danh sách ngoại lệ theo người (chốt 2026-10-09, thay số cố
 * định 1/1/1 của 2026-10-06). Cùng dạng với chụp CCCD ở `idCardScanMode.ts`.
 * Chưa ai lưu mức mặc định thì dùng `MAX_DRAFTS_PER_STAFF_BY_TYPE`.
 */

type LimitColumns = { limitNone: number; limitCnkd: number; limitHkd: number };

const fromRow = (r: LimitColumns): DraftLimits => ({ none: r.limitNone, CNKD: r.limitCnkd, HKD: r.limitHkd });
const toRow = (l: DraftLimits): LimitColumns => ({ limitNone: l.none, limitCnkd: l.CNKD, limitHkd: l.HKD });
const label = (l: DraftLimits) => `${l.none}/${l.CNKD}/${l.HKD}`;

const limitColumns = (t: typeof draftLimitDefault | typeof draftLimitOverrides) => ({
  limitNone: t.limitNone,
  limitCnkd: t.limitCnkd,
  limitHkd: t.limitHkd,
});

async function defaultLimits(): Promise<DraftLimits> {
  const [row] = await db.select(limitColumns(draftLimitDefault)).from(draftLimitDefault).limit(1);
  return row ? fromRow(row) : { ...MAX_DRAFTS_PER_STAFF_BY_TYPE };
}

/** Trần của người này. Route mở tài khoản hỏi hàm này trước khi giữ mã. */
export async function draftLimitsFor(userId: string): Promise<DraftLimits> {
  const [override] = await db
    .select(limitColumns(draftLimitOverrides))
    .from(draftLimitOverrides)
    .where(eq(draftLimitOverrides.userId, userId))
    .limit(1);
  return override ? fromRow(override) : defaultLimits();
}

export async function draftLimitSetting(): Promise<DraftLimitSetting> {
  const person = alias(users, "person");
  const [[current], overrides] = await Promise.all([
    db
      .select({
        ...limitColumns(draftLimitDefault),
        updatedAt: draftLimitDefault.updatedAt,
        updatedBy: users.fullName,
      })
      .from(draftLimitDefault)
      .innerJoin(users, eq(users.id, draftLimitDefault.updatedBy))
      .limit(1),
    db
      .select({
        userId: draftLimitOverrides.userId,
        fullName: person.fullName,
        departmentName: departments.name,
        ...limitColumns(draftLimitOverrides),
        updatedAt: draftLimitOverrides.updatedAt,
        updatedBy: users.fullName,
      })
      .from(draftLimitOverrides)
      .innerJoin(person, eq(person.id, draftLimitOverrides.userId))
      .leftJoin(departments, eq(departments.id, person.departmentId))
      .innerJoin(users, eq(users.id, draftLimitOverrides.updatedBy))
      .orderBy(asc(person.fullName)),
  ]);

  return {
    limits: current ? fromRow(current) : { ...MAX_DRAFTS_PER_STAFF_BY_TYPE },
    updatedAt: current?.updatedAt.toISOString() ?? "",
    updatedBy: current?.updatedBy ?? "",
    overrides: overrides.map((o) => ({
      userId: o.userId,
      fullName: o.fullName,
      departmentName: o.departmentName ?? "",
      limits: fromRow(o),
      updatedAt: o.updatedAt.toISOString(),
      updatedBy: o.updatedBy,
    })),
  };
}

export async function saveDraftLimit(actor: User, limits: DraftLimits): Promise<void> {
  const before = await defaultLimits();
  await db
    .insert(draftLimitDefault)
    .values({ id: 1, ...toRow(limits), updatedBy: actor.id })
    .onConflictDoUpdate({
      target: draftLimitDefault.id,
      set: { ...toRow(limits), updatedBy: actor.id, updatedAt: new Date() },
    });

  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Trần mã giới thiệu (Thường/CNKD/HKD), mức mặc định: ${label(before)} → ${label(limits)}`,
  });
}

/** Thêm hoặc đổi ngoại lệ của một người. `false` khi không có người với id đó. */
export async function saveDraftLimitOverride(actor: User, userId: string, limits: DraftLimits): Promise<boolean> {
  const [person] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  if (!person) return false;

  await db
    .insert(draftLimitOverrides)
    .values({ userId, ...toRow(limits), updatedBy: actor.id })
    .onConflictDoUpdate({
      target: draftLimitOverrides.userId,
      set: { ...toRow(limits), updatedBy: actor.id, updatedAt: new Date() },
    });

  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Trần mã giới thiệu (Thường/CNKD/HKD), ngoại lệ ${person.fullName}: ${label(limits)}`,
    targetTable: "draft_limit_overrides",
    targetId: userId,
  });
  return true;
}

export async function removeDraftLimitOverride(actor: User, userId: string): Promise<void> {
  const [removed] = await db
    .delete(draftLimitOverrides)
    .where(eq(draftLimitOverrides.userId, userId))
    .returning({ userId: draftLimitOverrides.userId });
  if (!removed) return;

  const [person] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Trần mã giới thiệu, bỏ ngoại lệ ${person?.fullName ?? userId}: theo mức mặc định`,
    targetTable: "draft_limit_overrides",
    targetId: userId,
  });
}

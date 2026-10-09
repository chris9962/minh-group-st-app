import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { IdCardScanSetting } from "@/lib/api/ops";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";
import { db } from "./db/client";
import { departments, idCardScanDefault, idCardScanOverrides, users } from "./db/schema";

/**
 * Chụp CCCD khi tạo khách: mức mặc định cộng danh sách ngoại lệ theo người
 * (chốt 2026-10-09, thay công tắc chung trong bộ nhớ app của 2026-10-08). Người
 * có ngoại lệ theo ngoại lệ, người khác theo mức mặc định. Chưa ai lưu mức mặc
 * định thì đọc `ID_CARD_SCAN` (`off` là tắt, thiếu hay giá trị khác là bật).
 *
 * Tắt thì form tạo khách bỏ bước chụp thẻ, người dùng gõ tay CCCD, họ tên, ngày
 * sinh như trước 2026-10-07, máy chủ không đòi ảnh.
 */

const envDefault = () => (process.env.ID_CARD_SCAN ?? "").trim() !== "off";
const label = (enabled: boolean) => (enabled ? "Bật" : "Tắt");

async function defaultEnabled(): Promise<boolean> {
  const [row] = await db.select({ enabled: idCardScanDefault.enabled }).from(idCardScanDefault).limit(1);
  return row?.enabled ?? envDefault();
}

/** Người này có phải chụp CCCD khi tạo khách không. Route tạo khách và form cùng hỏi hàm này. */
export async function idCardScanFor(userId: string): Promise<boolean> {
  const [override] = await db
    .select({ enabled: idCardScanOverrides.enabled })
    .from(idCardScanOverrides)
    .where(eq(idCardScanOverrides.userId, userId))
    .limit(1);
  return override?.enabled ?? defaultEnabled();
}

export async function idCardScanSetting(): Promise<IdCardScanSetting> {
  const person = alias(users, "person");
  const [[current], overrides] = await Promise.all([
    db
      .select({ enabled: idCardScanDefault.enabled, updatedAt: idCardScanDefault.updatedAt, updatedBy: users.fullName })
      .from(idCardScanDefault)
      .innerJoin(users, eq(users.id, idCardScanDefault.updatedBy))
      .limit(1),
    db
      .select({
        userId: idCardScanOverrides.userId,
        fullName: person.fullName,
        departmentName: departments.name,
        enabled: idCardScanOverrides.enabled,
        updatedAt: idCardScanOverrides.updatedAt,
        updatedBy: users.fullName,
      })
      .from(idCardScanOverrides)
      .innerJoin(person, eq(person.id, idCardScanOverrides.userId))
      .leftJoin(departments, eq(departments.id, person.departmentId))
      .innerJoin(users, eq(users.id, idCardScanOverrides.updatedBy))
      .orderBy(asc(person.fullName)),
  ]);

  return {
    enabled: current?.enabled ?? envDefault(),
    updatedAt: current?.updatedAt.toISOString() ?? "",
    updatedBy: current?.updatedBy ?? "",
    overrides: overrides.map((o) => ({
      ...o,
      departmentName: o.departmentName ?? "",
      updatedAt: o.updatedAt.toISOString(),
    })),
  };
}

export async function saveIdCardScan(actor: User, enabled: boolean): Promise<void> {
  const before = await defaultEnabled();
  await db
    .insert(idCardScanDefault)
    .values({ id: 1, enabled, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: idCardScanDefault.id,
      set: { enabled, updatedBy: actor.id, updatedAt: new Date() },
    });

  await logAudit(actor, {
    module: "customer",
    action: "update",
    targetLabel: `Chụp CCCD khi tạo khách, mức mặc định: ${label(before)} → ${label(enabled)}`,
  });
}

/** Thêm hoặc đổi ngoại lệ của một người. `false` khi không có người với id đó. */
export async function saveIdCardScanOverride(actor: User, userId: string, enabled: boolean): Promise<boolean> {
  const [person] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) return false;

  await db
    .insert(idCardScanOverrides)
    .values({ userId, enabled, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: idCardScanOverrides.userId,
      set: { enabled, updatedBy: actor.id, updatedAt: new Date() },
    });

  await logAudit(actor, {
    module: "customer",
    action: "update",
    targetLabel: `Chụp CCCD khi tạo khách, ngoại lệ ${person.fullName}: ${label(enabled)}`,
    targetTable: "id_card_scan_overrides",
    targetId: userId,
  });
  return true;
}

export async function removeIdCardScanOverride(actor: User, userId: string): Promise<void> {
  const [removed] = await db
    .delete(idCardScanOverrides)
    .where(eq(idCardScanOverrides.userId, userId))
    .returning({ userId: idCardScanOverrides.userId });
  if (!removed) return;

  const [person] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  await logAudit(actor, {
    module: "customer",
    action: "update",
    targetLabel: `Chụp CCCD khi tạo khách, bỏ ngoại lệ ${person?.fullName ?? userId}: theo mức mặc định`,
    targetTable: "id_card_scan_overrides",
    targetId: userId,
  });
}

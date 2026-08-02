import { db } from "./db/client";
import { auditLog } from "./db/schema";
import type { Action, ModuleKey, User } from "@/lib/types";

/**
 * Ghi nhật ký truy vết (P-93) — append-only, không có đường sửa/xoá.
 * Ghi cho mọi thao tác GHI và các lượt xem nhạy cảm (chi tiết nhân viên…).
 */
export async function logAudit(
  actor: User,
  entry: {
    module: ModuleKey;
    action: Action;
    targetLabel: string;
    targetTable?: string;
    targetId?: string;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    actorId: actor.id,
    module: entry.module,
    action: entry.action,
    targetLabel: entry.targetLabel,
    targetTable: entry.targetTable ?? null,
    targetId: entry.targetId ?? null,
  });
}

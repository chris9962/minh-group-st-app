import { eq } from "drizzle-orm";
import {
  PVI_ROUTE_MODE_LABEL,
  PviRouteMode,
  type PviRouteSetting,
} from "@/lib/api/ops";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";
import { db } from "./db/client";
import { appSettings, users } from "./db/schema";

/**
 * Chế độ điều hướng đơn bảo hiểm mới, lưu ở `app_settings` khoá `pvi_route`
 * (migration 0105). Màn Vận hành P-99 ghi, `newOrderRoute` đọc ở mỗi lượt tạo đơn.
 */

const KEY = "pvi_route";

/** Bảng chưa có dòng thì theo biến cũ, để deploy xong production chưa đổi hành vi. */
function modeFromEnv(): PviRouteMode {
  const configured = (process.env.PVI_ROUTE ?? "").trim();
  if (configured === "api" || configured === "bot") return configured;
  return "manual";
}

export async function pviRouteMode(): Promise<PviRouteMode> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, KEY));
  const saved = PviRouteMode.safeParse(row?.value);
  return saved.success ? saved.data : modeFromEnv();
}

export async function pviRouteSetting(): Promise<PviRouteSetting> {
  const [row] = await db
    .select({ value: appSettings.value, updatedAt: appSettings.updatedAt, updatedBy: users.fullName })
    .from(appSettings)
    .leftJoin(users, eq(users.id, appSettings.updatedBy))
    .where(eq(appSettings.key, KEY));
  const saved = PviRouteMode.safeParse(row?.value);

  return {
    mode: saved.success ? saved.data : modeFromEnv(),
    updatedAt: saved.success ? row.updatedAt.toISOString() : "",
    updatedBy: saved.success ? (row.updatedBy ?? "") : "",
  };
}

export async function savePviRouteMode(actor: User, mode: PviRouteMode): Promise<void> {
  const before = await pviRouteMode();
  await db
    .insert(appSettings)
    .values({ key: KEY, value: mode, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: mode, updatedBy: actor.id, updatedAt: new Date() },
    });

  await logAudit(actor, {
    module: "insurance",
    action: "update",
    targetLabel: `Điều hướng đơn bảo hiểm: ${PVI_ROUTE_MODE_LABEL[before]} → ${PVI_ROUTE_MODE_LABEL[mode]}`,
    targetTable: "app_settings",
    targetId: KEY,
  });
}

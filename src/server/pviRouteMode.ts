import {
  PVI_ROUTE_MODE_LABEL,
  type PviRouteMode,
  type PviRouteSetting,
} from "@/lib/api/ops";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";

/**
 * Chế độ điều hướng đơn bảo hiểm mới, giữ trong bộ nhớ của tiến trình app (chốt
 * 2026-09-25). Khởi tạo từ `PVI_ROUTE`, màn Vận hành P-99 đổi được lúc app đang
 * chạy. Khởi động lại hoặc deploy thì quay về `PVI_ROUTE`.
 *
 * Không đọc database: `createInsuranceOrders` gọi `newOrderRoute` bên trong
 * transaction đã khoá bộ đếm mã đơn. Xin thêm một kết nối ở đó thì mười lượt tạo
 * đơn cùng lúc dùng hết pool và chờ nhau mãi.
 *
 * Đặt trên `globalThis`: Next nạp lại module khi hot reload và mỗi bundle route
 * có thể mang bản riêng. Mỗi bản một biến thì màn P-99 đổi một bản, còn lượt tạo
 * đơn đọc bản khác.
 */

const store = globalThis as unknown as { mgstPviRoute?: PviRouteSetting };

function modeFromEnv(): PviRouteMode {
  const configured = (process.env.PVI_ROUTE ?? "").trim();
  if (configured === "api" || configured === "bot") return configured;
  return "manual";
}

function current(): PviRouteSetting {
  store.mgstPviRoute ??= { mode: modeFromEnv(), updatedAt: "", updatedBy: "" };
  return store.mgstPviRoute;
}

export const pviRouteMode = (): PviRouteMode => current().mode;

export const pviRouteSetting = (): PviRouteSetting => ({ ...current() });

export async function savePviRouteMode(actor: User, mode: PviRouteMode): Promise<void> {
  const before = current().mode;
  store.mgstPviRoute = { mode, updatedAt: new Date().toISOString(), updatedBy: actor.fullName };

  await logAudit(actor, {
    module: "insurance",
    action: "update",
    targetLabel: `Điều hướng đơn bảo hiểm: ${PVI_ROUTE_MODE_LABEL[before]} → ${PVI_ROUTE_MODE_LABEL[mode]}`,
  });
}

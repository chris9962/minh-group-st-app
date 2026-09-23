import { OPS_ORDER_SORTS } from "@/lib/api/ops";
import { actorWith } from "@/server/auth";
import { listOpsOrders, opsOrderFilterFrom } from "@/server/ops";
import { pageArgsFrom } from "@/server/pagination";

/** P-99 · Một trang đơn bảo hiểm, mọi trạng thái, lọc theo sản phẩm và trạng thái. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  return Response.json(
    await listOpsOrders(
      guard.actor,
      opsOrderFilterFrom(url),
      pageArgsFrom(url, OPS_ORDER_SORTS, "orderCode"),
    ),
  );
}

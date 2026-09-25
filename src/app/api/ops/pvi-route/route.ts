import { PviRouteBody } from "@/lib/api/ops";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { pviRouteSetting, savePviRouteMode } from "@/server/pviRouteMode";

/** P-99 · Chế độ điều hướng đơn bảo hiểm mới: làm tay, API hoặc bot. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(pviRouteSetting());
}

/** P-99 · Đổi chế độ điều hướng. Lượt tạo đơn kế tiếp dùng chế độ mới, không cần khởi động lại. */
export async function PUT(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const parsed = PviRouteBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Chế độ điều hướng không hợp lệ");

  await savePviRouteMode(guard.actor, parsed.data.mode);
  return new Response(null, { status: 204 });
}

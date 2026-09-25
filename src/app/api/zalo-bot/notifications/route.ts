import { actorWith } from "@/server/auth";
import { currentZaloAccountId, zaloNotificationRoutesFor } from "@/server/zaloBot";

/** Màn Bot Zalo · nhóm nhận từng loại thông báo, theo tài khoản Zalo đang đăng nhập. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(await zaloNotificationRoutesFor(await currentZaloAccountId()));
}

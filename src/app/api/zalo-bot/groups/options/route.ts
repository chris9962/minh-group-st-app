import { actorWith } from "@/server/auth";
import { currentZaloAccountId, zaloGroupOptions } from "@/server/zaloBot";

/** Màn Bot Zalo · trọn nhóm của tài khoản đang đăng nhập, cho hộp chọn nhóm nhận thông báo. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(await zaloGroupOptions(await currentZaloAccountId()));
}

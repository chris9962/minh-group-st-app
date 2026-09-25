import { actorWith } from "@/server/auth";
import { zaloBotSummary } from "@/server/zaloBot";

/** Màn Bot Zalo · trạng thái đăng nhập, mã QR đang chờ quét và tin nhắn gửi gần đây. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(await zaloBotSummary());
}

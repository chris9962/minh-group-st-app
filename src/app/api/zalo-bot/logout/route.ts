import { actorWith } from "@/server/auth";
import { requestZaloLogout } from "@/server/zaloBot";

/** Màn Bot Zalo · yêu cầu worker xoá phiên đã lưu rồi tạo mã QR mới. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  await requestZaloLogout();
  return new Response(null, { status: 204 });
}

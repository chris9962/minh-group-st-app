import { actorWith } from "@/server/auth";
import { requestZaloGroupsSync } from "@/server/zaloBot";

/** Màn Bot Zalo · yêu cầu worker tải lại danh sách nhóm từ Zalo. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  await requestZaloGroupsSync();
  return new Response(null, { status: 204 });
}

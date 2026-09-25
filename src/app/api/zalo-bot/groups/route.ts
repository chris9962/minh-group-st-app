import { ZALO_GROUP_SORTS } from "@/lib/api/zaloBot";
import { actorWith } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { currentZaloAccountId, listZaloGroups } from "@/server/zaloBot";

/** Màn Bot Zalo · một trang nhóm của tài khoản Zalo đang đăng nhập, tìm theo tên hoặc Thread ID. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  return Response.json(
    await listZaloGroups(
      await currentZaloAccountId(),
      url.searchParams.get("search") ?? "",
      pageArgsFrom(url, ZALO_GROUP_SORTS, "name"),
    ),
  );
}

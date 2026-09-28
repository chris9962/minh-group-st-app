import { ZALO_CONTACT_SORTS } from "@/lib/api/zaloBot";
import { actorWith } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { currentZaloAccountId, listZaloContacts } from "@/server/zaloBot";

/** Màn Bot Zalo · một trang số điện thoại đã tra ra uid, tìm theo tên, số hoặc uid. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  return Response.json(
    await listZaloContacts(
      await currentZaloAccountId(),
      url.searchParams.get("search") ?? "",
      pageArgsFrom(url, ZALO_CONTACT_SORTS, "name"),
    ),
  );
}

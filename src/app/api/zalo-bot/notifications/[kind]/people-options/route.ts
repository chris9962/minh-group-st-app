import { ZaloNotificationKind } from "@/lib/api/zaloBot";
import { actorWith, notFound } from "@/server/auth";
import { zaloPeopleOptions } from "@/server/zaloBot";

type Params = { params: Promise<{ kind: string }> };

/** Màn Bot Zalo · người chọn được làm người nhận riêng của một loại thông báo. */
export async function GET(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const kind = ZaloNotificationKind.safeParse((await params).kind);
  if (!kind.success) return notFound();

  return Response.json(await zaloPeopleOptions(kind.data));
}

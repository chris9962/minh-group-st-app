import { ZaloNotificationKind } from "@/lib/api/zaloBot";
import { actorWith, badRequest, notFound } from "@/server/auth";
import { queueZaloNotices } from "@/server/zalo/notifications";
import { currentZaloAccountId } from "@/server/zaloBot";

type Params = { params: Promise<{ kind: string }> };

/** Màn Bot Zalo · nút "Gửi ngay": dựng tin của loại này và đưa vào hàng chờ, worker gửi đi. */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const kind = ZaloNotificationKind.safeParse((await params).kind);
  if (!kind.success) return notFound();

  const accountId = await currentZaloAccountId();
  if (!accountId) return badRequest("Chưa đăng nhập tài khoản Zalo");

  const queued = await queueZaloNotices(accountId, kind.data, true);
  if (queued === null) return badRequest("Thông báo này chưa có nơi nhận");
  return Response.json({ queued });
}

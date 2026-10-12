import { ZaloNotificationKind, ZaloNotificationPgdsBody } from "@/lib/api/zaloBot";
import { actorWith, badRequest, jsonBody, notFound } from "@/server/auth";
import {
  currentZaloAccountId,
  saveZaloNotificationPgds,
  ZaloRouteError,
} from "@/server/zaloBot";

type Params = { params: Promise<{ kind: string }> };

/** Màn Bot Zalo · thay trọn danh sách Phó giám đốc của một loại thông báo, theo tài khoản đang đăng nhập. */
export async function PUT(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const kind = ZaloNotificationKind.safeParse((await params).kind);
  if (!kind.success) return notFound();

  const parsed = ZaloNotificationPgdsBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const accountId = await currentZaloAccountId();
  if (!accountId) return badRequest("Chưa đăng nhập tài khoản Zalo");

  try {
    await saveZaloNotificationPgds(guard.actor, accountId, kind.data, parsed.data.userIds);
  } catch (e) {
    if (e instanceof ZaloRouteError) return badRequest(e.message);
    throw e;
  }
  return new Response(null, { status: 204 });
}

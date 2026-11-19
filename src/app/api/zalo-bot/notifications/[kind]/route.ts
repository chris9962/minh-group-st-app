import { ZaloNotificationKind, ZaloNotificationRecipientsBody } from "@/lib/api/zaloBot";
import { actorWith, badRequest, jsonBody, notFound } from "@/server/auth";
import {
  currentZaloAccountId,
  saveZaloNotificationRecipients,
  ZaloRouteError,
} from "@/server/zaloBot";

type Params = { params: Promise<{ kind: string }> };

/** Màn Bot Zalo · thay trọn nơi nhận (nhóm, nhân viên, số nhập tay) của một loại thông báo, theo tài khoản đang đăng nhập. */
export async function PUT(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const kind = ZaloNotificationKind.safeParse((await params).kind);
  if (!kind.success) return notFound();

  const parsed = ZaloNotificationRecipientsBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const accountId = await currentZaloAccountId();
  if (!accountId) return badRequest("Chưa đăng nhập tài khoản Zalo");

  try {
    await saveZaloNotificationRecipients(guard.actor, accountId, kind.data, parsed.data);
  } catch (e) {
    if (e instanceof ZaloRouteError) return badRequest(e.message);
    throw e;
  }
  return new Response(null, { status: 204 });
}

import { isValidPhone } from "@/lib/format";
import { actorWith, badRequest } from "@/server/auth";
import { currentZaloAccountId, zaloThreadMessages } from "@/server/zaloBot";

/** Màn Bot Zalo · tin đã gửi tới một nơi nhận, theo `threadId` hoặc `phone`. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const threadId = params.get("threadId") ?? "";
  const phone = params.get("phone") ?? "";
  if (/^\d{1,32}$/.test(threadId))
    return Response.json(await zaloThreadMessages(await currentZaloAccountId(), { threadId }));
  if (/^\d+$/.test(phone) && isValidPhone(phone))
    return Response.json(await zaloThreadMessages(await currentZaloAccountId(), { phone }));
  return badRequest("Thiếu Thread ID hoặc số điện thoại");
}

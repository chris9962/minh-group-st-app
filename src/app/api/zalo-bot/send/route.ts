import { ZaloSendBody } from "@/lib/api/zaloBot";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { enqueueZaloMessage } from "@/server/zaloBot";

/**
 * Màn Bot Zalo · đưa một tin nhắn vào hàng chờ. Worker `zalo:worker` gửi trong
 * vòng vài giây; app không gửi thẳng vì phiên Zalo chỉ nằm trong worker.
 */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const parsed = ZaloSendBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  await enqueueZaloMessage(guard.actor, parsed.data);
  return new Response(null, { status: 204 });
}

import { MarkReadBody } from "@/lib/api/notifications";
import { badRequest, jsonBody, signedIn } from "@/server/auth";
import { markRead } from "@/server/notifications";

/**
 * Đánh dấu đã đọc. Bỏ trống `id` là đánh dấu TẤT CẢ.
 *
 * `markRead` luôn kèm `user_id` trong điều kiện, nên biết mã một dòng của người
 * khác cũng không đọc hộ được.
 */
export async function POST(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const parsed = MarkReadBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Mã thông báo không hợp lệ");

  await markRead(guard.actor.id, parsed.data.id);

  return new Response(null, { status: 204 });
}

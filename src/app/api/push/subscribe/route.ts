import { PushSubscriptionBody, PushUnsubscribeBody } from "@/lib/api/push";
import { badRequest, jsonBody, signedIn } from "@/server/auth";
import { removePushSubscription, savePushSubscription } from "@/server/push";

/**
 * Đăng ký và huỷ đăng ký nhận thông báo đẩy cho MỘT thiết bị.
 *
 * Không có quyền riêng. Ai đăng nhập cũng bật được thông báo cho máy của chính
 * mình, và chỉ cho chính mình: `user_id` lấy từ phiên đăng nhập, không lấy từ
 * thân request. Nhận `user_id` từ người gọi là mở đường đăng ký hộ người khác.
 */

export async function POST(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const parsed = PushSubscriptionBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Đăng ký nhận thông báo không hợp lệ");

  await savePushSubscription(guard.actor.id, {
    ...parsed.data,
    userAgent: request.headers.get("user-agent") ?? "",
  });

  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const parsed = PushUnsubscribeBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Thiếu địa chỉ đăng ký cần xoá");

  // Kèm `user_id` trong điều kiện xoá: biết `endpoint` của người khác thì vẫn
  // không tắt được thông báo của họ.
  await removePushSubscription(guard.actor.id, parsed.data.endpoint);

  return new Response(null, { status: 204 });
}

import { NotificationPrefBody } from "@/lib/api/notificationPrefs";
import { badRequest, jsonBody, signedIn } from "@/server/auth";
import { readNotificationPrefs, setNotificationPref } from "@/server/notificationPrefs";

/**
 * C-09 · Loại thông báo người đang đăng nhập muốn nhận.
 *
 * Không có quyền riêng, và luôn đọc ghi cho CHÍNH người đăng nhập. Không nhận
 * `user_id` từ người gọi: đây là lựa chọn cá nhân, không phải thứ người khác
 * đặt hộ.
 */

export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  return Response.json(await readNotificationPrefs(guard.actor.id));
}

export async function PUT(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const parsed = NotificationPrefBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Loại thông báo không hợp lệ");

  await setNotificationPref(guard.actor.id, parsed.data.kind, parsed.data.enabled);

  return new Response(null, { status: 204 });
}

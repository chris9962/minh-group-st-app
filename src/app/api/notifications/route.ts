import { NOTIFICATION_SORT } from "@/lib/api/notifications";
import { signedIn } from "@/server/auth";
import { listNotifications } from "@/server/notifications";
import { pageArgsFrom } from "@/server/pagination";

/**
 * C-09 · Danh sách thông báo của CHÍNH người đăng nhập.
 *
 * Không có quyền riêng và không có tham số chọn người: thông báo thuộc về một
 * người, `user_id` lấy từ phiên đăng nhập.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);

  return Response.json(
    await listNotifications(guard.actor.id, pageArgsFrom(url, NOTIFICATION_SORT, "at")),
  );
}

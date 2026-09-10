import { signedIn } from "@/server/auth";
import { unreadCount } from "@/server/notifications";

/**
 * Số thông báo chưa đọc, cho chuông trên thanh trên.
 *
 * Tách khỏi route danh sách vì chuông hỏi lại 60 giây một lần trên MỌI màn. Câu
 * này chỉ đếm trên chỉ mục một phần `notifications_unread`, không đọc `payload`
 * và không cắt trang.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  return Response.json({ unread: await unreadCount(guard.actor.id) });
}

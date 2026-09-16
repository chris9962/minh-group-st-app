import { signedIn } from "@/server/auth";
import { pendingRelease, unreadCount } from "@/server/notifications";

/**
 * Số thông báo chưa đọc, cho chuông trên thanh trên.
 *
 * Tách khỏi route danh sách vì chuông hỏi lại 60 giây một lần trên MỌI màn. Câu
 * này chỉ đếm trên chỉ mục một phần `notifications_unread`, không đọc `payload`
 * và không cắt trang.
 *
 * `release` ghép vào cùng lượt hỏi thay vì mở route riêng: hộp thoại che màn
 * hình phải hiện ngay khi có bản cập nhật, và chu kỳ 60 giây ở đây đã có sẵn.
 * Câu đó cũng đi qua chỉ mục chưa đọc, gần như luôn trả rỗng.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const [unread, release] = await Promise.all([
    unreadCount(guard.actor.id),
    pendingRelease(guard.actor.id),
  ]);
  return Response.json({ unread, release });
}

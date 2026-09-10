import { badRequest, signedIn } from "@/server/auth";
import { pushConfigured, sendPushToUser } from "@/server/push";

/**
 * Gửi một thông báo thử tới CHÍNH người đang đăng nhập.
 *
 * Chỉ gửi cho bản thân, không nhận `user_id` từ đâu cả. Route này để người dùng
 * tự kiểm máy của mình đã nhận được thông báo chưa, không phải công cụ nhắn tin
 * cho người khác.
 */
export async function POST(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  if (!pushConfigured()) {
    return badRequest("Máy chủ chưa cấu hình khoá VAPID cho thông báo đẩy");
  }

  const at = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

  const result = await sendPushToUser(guard.actor.id, {
    title: "Minh Group ST",
    body: `Thông báo thử lúc ${at}. Bạn đã nhận được thì phần đẩy chạy đúng.`,
    url: "/profile",
    // Mỗi lần một `tag` khác nhau, để bấm gửi nhiều lần thì thấy nhiều thông
    // báo chứ không phải một thông báo bị thay chỗ.
    tag: `test-${Date.now()}`,
  });

  return Response.json(result);
}

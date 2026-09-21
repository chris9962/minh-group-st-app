import { signedIn } from "@/server/auth";
import { mustConfirmStartDate } from "@/server/insurance";

/**
 * Form tạo đơn hỏi: người đang đăng nhập có phải xác nhận ngày bắt đầu với
 * khách không (chốt 2026-09-19). Luôn trả cho CHÍNH người gọi, không nhận
 * `user_id`: đây là luật áp lên người nhập, không phải thứ tra hộ người khác.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  return Response.json({ required: await mustConfirmStartDate(guard.actor) });
}

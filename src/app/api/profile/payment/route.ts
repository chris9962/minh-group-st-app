import { getActor, notFound, unauthorized } from "@/server/auth";
import { staffPaymentOf } from "@/server/staffPayment";

/**
 * Thông tin thanh toán của chính người đang gọi, màn Cá nhân. Chỉ có GET: nhân
 * viên không tự sửa tài khoản nhận lương (chốt 2026-11-13). Người này là ai lấy
 * từ phiên, không lấy từ tham số.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const found = await staffPaymentOf(actor.id);
  if (!found) return notFound();
  return Response.json(found.payment);
}

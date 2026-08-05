import { actorWith } from "@/server/auth";
import { listOpenReferralCodes } from "@/server/catalog";

/**
 * Mã còn chỗ của MỘT ngân hàng — nguồn cho ô chọn mã lúc KD mở tài khoản.
 *
 * Tách khỏi `/referral-codes` (bảng P-61, luôn phân trang) vì hai câu hỏi khác
 * nhau: bảng cần xem cả kho từng trang một, ô chọn cần trọn danh sách còn dùng
 * được. Nhét chung một route thì phải mở đường "lấy hết", mà đường đó là chỗ
 * mọi màn sau này lách phân trang.
 *
 * Quyền theo `create` của module ngân hàng, KHÔNG phải `manage-referral-codes`:
 * KD mở tài khoản thì được chọn mã, nhưng không được vào kho mã.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "banking", "create");
  if (!guard.ok) return guard.response;

  const bankId = new URL(request.url).searchParams.get("bankId") ?? "";
  if (!bankId) return Response.json([]);

  return Response.json(await listOpenReferralCodes(bankId));
}

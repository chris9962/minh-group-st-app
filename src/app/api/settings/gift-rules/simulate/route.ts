import { GiftSimulateInput } from "@/lib/api/settings";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { giftSimulate } from "@/server/gift";

/**
 * P-81 · Nút thử quy tắc quà — CHỈ TÍNH, không ghi gì (spec §5.3).
 *
 * Không tạo khách, không tạo đơn, không trừ mã giới thiệu, không đụng
 * `gift_grants`. Bấm bao nhiêu lần cũng được.
 *
 * Vẫn gác quyền dù không ghi: kết quả nói ra chính sách quà và thang điểm của
 * kỳ, thứ chỉ người cấu hình nghiệp vụ mới cần thấy.
 */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-gift-rules");
  if (!guard.ok) return guard.response;

  const parsed = GiftSimulateInput.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Dữ liệu thử không hợp lệ");

  return Response.json(await giftSimulate(parsed.data));
}

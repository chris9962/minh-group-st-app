import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { plateOverlaps } from "@/server/insurance";

/**
 * Form tạo đơn hỏi trước khi mở màn kiểm lại: biển số này đã có đơn xe máy
 * chồng ngày hiệu lực chưa (chốt 2026-10-21). Trả đơn của mọi phòng, vì một
 * xe chỉ cần bảo hiểm một lần dù nhân viên phòng nào lập đơn.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "create")) return forbidden();

  const params = new URL(request.url).searchParams;
  const licensePlate = params.get("licensePlate") ?? "";
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  if (!isRealIsoDate(startDate) || !isRealIsoDate(endDate)) return badRequest("Ngày không hợp lệ");

  return Response.json(await plateOverlaps(licensePlate, startDate, endDate));
}

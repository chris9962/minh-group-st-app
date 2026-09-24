import { isRealIsoDate } from "@/lib/types";
import { badRequest, signedIn } from "@/server/auth";
import { customerAddressesInRange, customerListScope } from "@/server/customers";

/**
 * Ô lọc Ấp của P-40: địa chỉ của khách lập trong khoảng ngày.
 *
 * Route riêng chứ không phải tham số của `/api/customers`: đường đó trả một
 * TRANG, còn ô chọn cần trọn danh sách (AGENTS.md §5.1, điều 4). Áp cùng phạm vi
 * với bảng, nên ô lọc không lộ ấp của khách mà người xem không được thấy.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isRealIsoDate(from) || !isRealIsoDate(to)) return badRequest("Khoảng ngày không hợp lệ");

  const addresses = await customerAddressesInRange({
    from,
    to,
    ...customerListScope(guard.actor),
  });
  return Response.json({ addresses });
}

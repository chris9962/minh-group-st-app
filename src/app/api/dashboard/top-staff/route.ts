import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { dashboardVisibility, topStaffForMonths } from "@/server/dashboard";

/** Mỗi tháng là hai phép đếm trên kho tài khoản; trần này giữ một lượt mở modal trong vài giây. */
const MAX_MONTHS = 12;

/**
 * P-80 · Modal mở rộng của khối "Cá nhân xuất sắc": cộng dồn các tháng đã chọn
 * (chốt 2026-10-08). Chỉ người xem toàn công ty có, cùng điều kiện với khối đó.
 *
 *   GET /api/dashboard/top-staff?months=2026-08,2026-09,2026-10
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (dashboardVisibility(actor).kind !== "company") return forbidden();

  const raw = new URL(request.url).searchParams.get("months") ?? "";
  const months = [...new Set(raw.split(",").filter(Boolean))];
  if (
    months.length === 0 ||
    months.length > MAX_MONTHS ||
    !months.every((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m))
  )
    return badRequest(`Chọn từ 1 đến ${MAX_MONTHS} tháng`);

  return Response.json(await topStaffForMonths(months));
}

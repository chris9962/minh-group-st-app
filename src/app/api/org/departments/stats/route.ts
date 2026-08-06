import { can } from "@/lib/permissions";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { departmentStatsFor } from "@/server/org";

/**
 * P-91 · Bốn cột số liệu nghiệp vụ của bảng phòng ban, luôn ở phạm vi TOÀN
 * CÔNG TY — màn này không có thanh chọn phạm vi như dashboard P-80.
 *
 * Gác bằng `manage-org` chứ không phải `banking:view-summary`: chỉ người vào
 * được màn Phòng ban mới gọi tới đây, và đó đúng là tập người có `manage-org`.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "manage-org")) return forbidden();

  // Kỳ do `PeriodPicker` gửi: `today` · `this-month` · `range:từ:đến`. Chuỗi lạ
  // rơi về `today` ở tầng dưới, không trả 400 — một ô địa chỉ gõ nhầm không
  // đáng làm hỏng cả màn.
  const period = new URL(request.url).searchParams.get("period") ?? "today";

  return Response.json(await departmentStatsFor(period));
}

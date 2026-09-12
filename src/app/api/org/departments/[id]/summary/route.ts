import { canOrg, visibleOrgDepartmentIds } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { businessDay } from "@/lib/format";
import { bankingSummaryFor, periodRanges } from "@/server/dashboard";

type Params = { params: Promise<{ id: string }> };

/**
 * Khối số ngân hàng của MỘT phòng trong một kỳ, cho trang chi tiết phòng ban.
 *
 * Cùng hàm đếm với Tổng quan P-80, chỉ khoá phạm vi vào đúng phòng này. Gác
 * bằng quyền vào được màn Phòng ban, cùng lý do với `/stats`: bảng P-91 đã bày
 * ba con số này cho từng phòng, route này chỉ chia nhỏ thêm.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOrg(actor, "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Ngoài phạm vi trả 404 như route chi tiết: 403 là nói ra rằng phòng đó có
  // tồn tại, mà người hỏi không được biết điều đó.
  const visible = visibleOrgDepartmentIds(actor);
  if (visible !== null && !visible.includes(id)) return notFound();

  const period = new URL(request.url).searchParams.get("period") ?? "today";
  const { current } = periodRanges(period, businessDay());

  return Response.json(
    await bankingSummaryFor({ kind: "departments", departmentIds: [id] }, actor.id, current),
  );
}

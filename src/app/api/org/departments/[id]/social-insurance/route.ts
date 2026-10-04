import { canOrg, visibleOrgDepartmentIds } from "@/lib/permissions";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { businessMonth } from "@/lib/format";
import { departmentSocialInsurance } from "@/server/socialInsurance";

type Params = { params: Promise<{ id: string }> };

/**
 * Doanh thu BHYT/BHXH của Phòng An Sinh theo tháng biên lai, cho trang chi tiết
 * phòng ban. Gác cùng cách với khối số ngân hàng ở `/summary`.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOrg(actor, "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const visible = visibleOrgDepartmentIds(actor);
  if (visible !== null && !visible.includes(id)) return notFound();

  const month = new URL(request.url).searchParams.get("month") ?? businessMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest();

  return Response.json(await departmentSocialInsurance(id, month));
}

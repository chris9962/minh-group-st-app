import { STAFF_SORT } from "@/lib/api/staff";
import { can } from "@/lib/permissions";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { payrollFor, staffQueryFrom } from "@/server/staff";

/** Màn Lương. Gác bằng `salary:view-detail`, không bằng quyền Nhân sự (chốt 2026-11-16). */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // `clampScope` rơi về `own` khi thiếu quyền, nên phải chặn trước.
  if (!can(actor, "salary", "view-detail")) return forbidden();

  const url = new URL(request.url);
  const query = staffQueryFrom(url.searchParams);
  if (!query) return badRequest("Tháng không hợp lệ");

  return Response.json(await payrollFor(actor, query, pageArgsFrom(url, STAFF_SORT, "name")));
}

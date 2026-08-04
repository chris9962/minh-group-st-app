import { can } from "@/lib/permissions";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { isPeriod, isYearMonth, peopleFor } from "@/server/people";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // `clampScope` rơi về `own` khi không có quyền nào, mà `own` lại là CẢ PHÒNG —
  // thiếu chốt này thì nhân viên kinh doanh xem được điểm của mọi đồng nghiệp.
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const params = new URL(request.url).searchParams;
  const period = params.get("period") ?? "today";
  const summaryMonth = params.get("summaryMonth") ?? "";
  if (!isPeriod(period)) return badRequest("Kỳ xem không hợp lệ");
  if (summaryMonth && !isYearMonth(summaryMonth)) return badRequest("Tháng không hợp lệ");

  return Response.json(
    await peopleFor(actor, {
      scope: params.get("scope") ?? "",
      period,
      summaryMonth,
      departmentId: params.get("departmentId") ?? "",
      search: params.get("search") ?? "",
    }),
  );
}

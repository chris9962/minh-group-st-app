import { DEPARTMENT_POINTS_SORT } from "@/lib/api/departmentPoints";
import { actorWith } from "@/server/auth";
import { departmentPointsList } from "@/server/departmentPoints";
import { pageArgsFrom } from "@/server/pagination";

/** P-54 · Nhân viên bị loại khỏi điểm phòng của một tháng. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "staff", "exclude-department-points");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const params = url.searchParams;
  return Response.json(
    await departmentPointsList(
      {
        month: params.get("month") ?? "",
        departmentId: params.get("departmentId") ?? "",
        search: params.get("search") ?? "",
      },
      pageArgsFrom(url, DEPARTMENT_POINTS_SORT, "at"),
    ),
  );
}

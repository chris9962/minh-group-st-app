import { actorWith } from "@/server/auth";
import { departmentPointsOptions } from "@/server/departmentPoints";

/** P-54 · Ô chọn của form Thêm: nhân viên chưa bị loại trong tháng. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "staff", "exclude-department-points");
  if (!guard.ok) return guard.response;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return Response.json(await departmentPointsOptions(month));
}

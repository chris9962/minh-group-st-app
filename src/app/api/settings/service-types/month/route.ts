import { SERVICE_WEIGHTS_FROM } from "@/lib/api/settings";
import { actorWith, badRequest } from "@/server/auth";
import { listServiceTypes } from "@/server/catalog";
import { isMonthClosed } from "@/server/closedMonths";

/**
 * P-84 theo tháng. Trạng thái chốt lương đi kèm ở đây chứ không đọc từ
 * `/api/salary-closings`: route đó đòi quyền chốt lương, người sửa danh mục
 * chưa chắc có.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest();

  const [rows, closed] = await Promise.all([listServiceTypes(month), isMonthClosed(month)]);
  return Response.json({ month, locked: closed || month < SERVICE_WEIGHTS_FROM, rows });
}

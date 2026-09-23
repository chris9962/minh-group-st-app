import { actorWith } from "@/server/auth";
import { opsDaysFrom, opsSummary } from "@/server/ops";

/**
 * P-99 · Số liệu vận hành hệ thống.
 *
 * Một route trả cả ba khối chứ không tách ba đường: màn vẽ chúng cùng lúc và
 * làm mới cùng nhịp, tách ra chỉ thêm ba lượt kiểm phiên cho cùng một lần mở.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  return Response.json(await opsSummary(opsDaysFrom(url.searchParams.get("days"))));
}

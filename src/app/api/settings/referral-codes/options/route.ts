import { actorWith } from "@/server/auth";
import { listReferralCodeOptions } from "@/server/catalog";

/**
 * Tên mã cho các ô LỌC ở màn ngân hàng và màn xuất Excel.
 *
 * Khác `/open` ở chỗ trả cả mã đã đầy: lọc lịch sử theo một mã tiêu hết từ tháng
 * trước là việc thường xuyên, cắt nó đi thì báo cáo cũ không tra lại được.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "banking", "view-summary");
  if (!guard.ok) return guard.response;

  return Response.json(await listReferralCodeOptions());
}

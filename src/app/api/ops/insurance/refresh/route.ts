import { OpsRefreshBody } from "@/lib/api/ops";
import { can } from "@/lib/permissions";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { refreshPolicies } from "@/server/ops";

/**
 * P-99 · Đưa một LÔ đơn về hàng đợi GCN để worker API hỏi lại PVI.
 *
 * `insurance:update` ngoài `system:view-ops`: lượt này xoá ảnh giấy chứng nhận
 * đang có và đưa đơn Hoàn thành về Đợi GCN.
 *
 * Trả 200 kể cả khi mọi đơn đều hỏng, cùng lý do với route cấp lại: mỗi đơn có
 * kết quả riêng.
 */
export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "view-ops")) return forbidden();
  if (!can(actor, "insurance", "update")) return forbidden();

  const parsed = OpsRefreshBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  return Response.json(await refreshPolicies(actor, parsed.data));
}

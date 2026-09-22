import { OpsRecreateBody } from "@/lib/api/ops";
import { can } from "@/lib/permissions";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { recreateStuckOrders } from "@/server/ops";

/**
 * P-99 · Huỷ và cấp lại một LÔ đơn kẹt ở chờ giấy chứng nhận.
 *
 * Hai quyền chứ không một: `system:view-ops` mở màn, `insurance:create` mới là
 * quyền lập đơn — kết quả của lượt bấm này là một loạt đơn mới, đúng thứ quyền
 * kia nói tới. Luật huỷ từng đơn vẫn do `cancelInsuranceOrder` giữ, nên người
 * không có `insurance:set-status` chỉ cấp lại được đơn lập trong ngày.
 *
 * Trả 200 kể cả khi mọi đơn đều không làm được: đây là lô, mỗi đơn có kết quả
 * riêng, và màn in từng dòng. Một mã lỗi chung sẽ giấu mất đơn nào hỏng vì sao.
 */
export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "view-ops")) return forbidden();
  if (!can(actor, "insurance", "create")) return forbidden();

  const parsed = OpsRecreateBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  return Response.json(await recreateStuckOrders(actor, parsed.data));
}

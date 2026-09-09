import { logAudit } from "@/server/audit";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { sendInsuranceOrderToManual } from "@/server/insurance";

/**
 * P-13 · Rút đơn khỏi hàng chờ của bot, đưa sang hàng chờ làm tay.
 *
 * Route RIÊNG, không gộp vào `../status/override`. Đường kia nhận trạng thái
 * tuỳ ý và mở cho quyền `insurance:set-status`; đường này đi đúng MỘT bước
 * `queued` → `manual-queued` và chỉ mở cho Giám đốc. Gộp lại thì một tham số
 * gõ thêm là đi vòng qua ràng buộc chức vụ.
 *
 * Không nhận body: bước chuyển đã cố định trong tên route.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (actor.role !== "director") return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await sendInsuranceOrderToManual(actor, id);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(actor, {
    module: "insurance",
    action: "set-status",
    targetLabel: `Đơn ${result.value.orderCode} → Chờ làm tay (rút khỏi bot)`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return Response.json(result.value);
}

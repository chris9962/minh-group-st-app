import { InsuranceCancelForm } from "@/lib/api/insurance";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import {
  badRequest,
  forbidden,
  getActor,
  isUuid,
  jsonBody,
  notFound,
  unauthorized,
} from "@/server/auth";
import { cancelInsuranceOrder } from "@/server/insurance";

/**
 * P-14 · Huỷ đơn kèm lý do.
 *
 * Route RIÊNG với `../status/override`: đường kia đặt trạng thái tuỳ ý và không
 * nhận lý do, đường này chỉ đi tới `cancelled` và BẮT có lý do. Gộp lại thì lý
 * do thành tham số không bắt buộc, và bỏ nó khỏi thân yêu cầu là huỷ được đơn
 * mà không ai biết vì sao.
 *
 * Cùng quyền `insurance:set-status` với ô "Đặt trạng thái" — chốt 2026-08-30:
 * ai đặt được trạng thái tuỳ ý thì huỷ được đơn.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "set-status")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = InsuranceCancelForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await cancelInsuranceOrder(actor, id, parsed.data.note);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  // Lý do vào luôn nhãn nhật ký: người đọc nhật ký không mở từng đơn ra xem
  // dòng thời gian mới biết vì sao đơn đó biến mất khỏi hàng chờ.
  await logAudit(actor, {
    module: "insurance",
    action: "set-status",
    targetLabel: `Đơn ${result.value.orderCode} → Huỷ đơn · ${parsed.data.note}`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return Response.json(result.value);
}

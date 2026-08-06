import { z } from "zod";
import { INSURANCE_STATUS_LABEL, InsuranceManualStep } from "@/lib/api/insuranceOrders";
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
import { setInsuranceOrderStatus } from "@/server/insurance";

const Body = z.object({ status: InsuranceManualStep });

/**
 * P-16 (gộp vào P-14) · "Nhận đơn xử lý" và "Đánh dấu hoàn thành".
 *
 * Chỉ nhận hai bước của nhánh làm tay, và máy chủ còn kiểm tiếp trạng thái
 * hiện tại có cho phép bước đó không (spec §3.4) — client không đặt được trạng
 * thái tuỳ ý.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "handle-fallback")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await setInsuranceOrderStatus(actor, id, parsed.data.status);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(actor, {
    module: "insurance",
    action: "handle-fallback",
    targetLabel: `Đơn ${result.value.orderCode} → ${INSURANCE_STATUS_LABEL[parsed.data.status]}`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return Response.json(result.value);
}

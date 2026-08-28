import { z } from "zod";
import { INSURANCE_STATUS_LABEL } from "@/lib/api/insuranceOrders";
import { can } from "@/lib/permissions";
import { InsuranceOrderStatus } from "@/lib/api/insuranceOrders";
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
import { overrideInsuranceOrderStatus } from "@/server/insurance";

const Body = z.object({ status: InsuranceOrderStatus });

/**
 * P-14 · Đặt trạng thái đơn tuỳ ý — công cụ gỡ đơn mắc.
 *
 * Route RIÊNG, không gộp vào `../status`. Đường kia chỉ nhận hai bước của nhánh
 * làm tay và kiểm bảng bước chuyển; gộp lại thì một tham số gõ thêm là bỏ qua
 * cả vòng đời, và người đọc code không thấy được đường nào chặt đường nào lỏng.
 *
 * Quyền `insurance:set-status` cấp riêng, không đi kèm `handle-fallback`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "set-status")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await overrideInsuranceOrderStatus(actor, id, parsed.data.status);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  // Ghi `set-status` chứ không phải `handle-fallback`: đọc nhật ký phải phân
  // biệt được lượt đi đúng vòng đời với lượt đặt tay bỏ qua vòng đời.
  await logAudit(actor, {
    module: "insurance",
    action: "set-status",
    targetLabel: `Đơn ${result.value.orderCode} → ${INSURANCE_STATUS_LABEL[parsed.data.status]} (đặt tay)`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return Response.json(result.value);
}

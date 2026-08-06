import { InsuranceOrderForm } from "@/lib/api/insuranceOrders";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { createInsuranceOrders } from "@/server/insurance";

/**
 * P-10/P-11 gộp · Tạo đơn bảo hiểm. Một gói khai mấy leg thì sinh bấy nhiêu đơn
 * (chốt 04/08), tất cả trong MỘT giao dịch — nửa chùm là dữ liệu rác.
 *
 * Người tạo và đơn vị lúc tạo do máy chủ tự ghi, không nhận từ client: nhận
 * `actorId` là mở đường ghi tên người khác vào công của mình.
 */
export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "create")) return forbidden();

  // Máy chủ tự kiểm dữ liệu vào — không tin client đã chạy zod.
  const parsed = InsuranceOrderForm.safeParse(await jsonBody(request));
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  const result = await createInsuranceOrders(actor, parsed.data);
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  for (const order of result.value) {
    await logAudit(actor, {
      module: "insurance",
      action: "create",
      targetLabel: `Đơn ${order.orderCode} · ${order.customerName}`,
      targetTable: "insurance_orders",
      targetId: order.id,
    });
  }

  return Response.json(result.value, { status: 201 });
}

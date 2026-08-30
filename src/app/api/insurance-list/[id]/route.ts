import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import {
  forbidden,
  getActor,
  isUuid,
  jsonBody,
  notFound,
  unauthorized,
} from "@/server/auth";
import {
  deleteInsuranceOrder,
  insuranceOrderDetail,
  updateInsuranceOrder,
} from "@/server/insurance";

/** P-14 · Chi tiết một đơn, kèm dòng thời gian trạng thái. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const order = await insuranceOrderDetail(actor, id);
  // Ngoài tầm nhìn trả 404 y hệt "không tồn tại" — 403 là xác nhận id có thật.
  if (!order) return notFound();

  return Response.json(order);
}

/**
 * Sửa một đơn chưa hoàn thành.
 *
 * Cố ý KHÔNG parse ở đây: luật biển số phụ thuộc sản phẩm, mà sản phẩm phải đọc
 * từ database chứ không lấy thứ client gửi lên. `updateInsuranceOrder` làm cả
 * hai việc đó cùng chỗ.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await updateInsuranceOrder(actor, id, await jsonBody(request));
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "insurance",
    action: "update",
    targetLabel: `Đơn ${result.value.orderCode} · ${result.value.customerName}`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return Response.json(result.value);
}

/** XOÁ HẲN một đơn chưa hoàn thành. Huỷ đơn mà giữ lại vết thì đi `../insurance-orders/[id]/cancel`. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "delete")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await deleteInsuranceOrder(actor, id);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "insurance",
    action: "delete",
    targetLabel: `Đơn ${result.value.orderCode} · ${result.value.customerName}`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return new Response(null, { status: 204 });
}

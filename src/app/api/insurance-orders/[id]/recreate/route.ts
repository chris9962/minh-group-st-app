import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { recreateInsuranceOrder } from "@/server/insurance";

/**
 * P-14 · Cấp lại một đơn đã huỷ — lập đơn MỚI thay cho nó.
 *
 * Gác bằng `insurance:create` chứ không phải `update`: kết quả của lượt này là
 * một đơn mới đứng tên người bấm, đúng thứ quyền tạo đơn nói tới. `update` là
 * quyền sửa bản ghi đã có, mà đơn đã huỷ thì không sửa được nữa.
 *
 * Thân yêu cầu KHÔNG parse ở đây: luật biển số và số thành viên phụ thuộc sản
 * phẩm, mà sản phẩm phải đọc từ database — xem `recreateInsuranceOrder`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "create")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await jsonBody(request)) as { departmentId?: unknown };
  const departmentId = typeof body?.departmentId === "string" ? body.departmentId : "";

  const result = await recreateInsuranceOrder(actor, id, body, departmentId);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(actor, {
    module: "insurance",
    action: "create",
    targetLabel: `Đơn ${result.value.orderCode} cấp lại cho một đơn đã huỷ · ${result.value.customerName}`,
    targetTable: "insurance_orders",
    targetId: result.value.id,
  });
  return Response.json(result.value, { status: 201 });
}

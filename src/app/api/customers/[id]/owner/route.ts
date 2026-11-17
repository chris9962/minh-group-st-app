import { CustomerOwnerForm } from "@/lib/api/customers";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { transferCustomerOwner } from "@/server/transfers";

/** Đổi người tạo hồ sơ khách sang nhân viên khác cùng phòng. Quyền `customer:change-owner`, theo phạm vi của quyền đó. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actorWith(request, "customer", "change-owner");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = CustomerOwnerForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Chưa chọn nhân viên nhận");

  const result = await transferCustomerOwner(guard.actor, id, parsed.data.userId);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const { customerName, fromName, toName } = result.value;
  await logAudit(guard.actor, {
    module: "customer",
    action: "change-owner",
    targetLabel: `Đổi người tạo khách hàng ${customerName} từ ${fromName || "(không rõ)"} sang ${toName}`,
    targetTable: "customers",
    targetId: id,
  });
  return Response.json({ ok: true });
}

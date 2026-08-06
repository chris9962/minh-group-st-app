import { ServiceEditForm } from "@/lib/api/services";
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
import { deleteService, updateService } from "@/server/services";

/** Sửa loại dịch vụ hoặc ghi chú. Khách, người làm và ngày thì không đổi được. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "services", "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = ServiceEditForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateService(actor, id, parsed.data);
  // `null` = không có hoặc ngoài tầm nhìn — 404 giống hệt nhau.
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "services",
    action: "update",
    targetLabel: `Dịch vụ ${result.service.serviceTypeName} cho ${result.service.customerName}`,
    targetTable: "services",
    targetId: id,
  });
  return Response.json(result.service);
}

/** Xoá hẳn — không có trạng thái "đã huỷ". */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "services", "delete")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Ngoài tầm nhìn trả 404 y hệt "không tồn tại" — 403 là xác nhận id có thật.
  const removed = await deleteService(actor, id);
  if (!removed) return notFound();

  await logAudit(actor, {
    module: "services",
    action: "delete",
    targetLabel: `Dịch vụ ${removed.serviceTypeName} cho ${removed.customerName}`,
    targetTable: "services",
    targetId: removed.id,
  });
  return new Response(null, { status: 204 });
}

import { CustomerNoteForm } from "@/lib/api/customers";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { logAudit } from "@/server/audit";
import { updateCustomerNote } from "@/server/customers";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actorWith(request, "customer", "update");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = CustomerNoteForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Ghi chú phải là văn bản, tối đa 5.000 ký tự");
  const result = await updateCustomerNote(guard.actor, id, parsed.data.note);
  if (!result) return notFound();
  await logAudit(guard.actor, {
    module: "customer", action: "update",
    targetLabel: `Sửa ghi chú khách hàng ${result.fullName}`,
    targetTable: "customers", targetId: id,
  });
  return Response.json({ note: result.note });
}

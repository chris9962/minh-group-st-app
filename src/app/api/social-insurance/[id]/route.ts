import { RecordEditForm } from "@/lib/api/socialInsurance";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { deleteSocialInsurance, updateSocialInsurance } from "@/server/socialInsurance";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actorWith(request, "social-insurance", "update");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = RecordEditForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateSocialInsurance(guard.actor, id, parsed.data);
  if (result === null) return notFound();
  if (!result.ok)
    return Response.json({ message: result.message, fieldErrors: result.fieldErrors }, { status: 422 });

  await logAudit(guard.actor, {
    module: "social-insurance",
    action: "update",
    targetLabel: `BHYT/BHXH của ${result.record.customerName}`,
    targetTable: "social_insurance_records",
    targetId: id,
  });
  return Response.json(result.record);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actorWith(request, "social-insurance", "delete");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await deleteSocialInsurance(guard.actor, id);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(guard.actor, {
    module: "social-insurance",
    action: "delete",
    targetLabel: `BHYT/BHXH của ${result.record.customerName}`,
    targetTable: "social_insurance_records",
    targetId: id,
  });
  return new Response(null, { status: 204 });
}

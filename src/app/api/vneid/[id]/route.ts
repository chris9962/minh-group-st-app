import { VneidEditForm } from "@/lib/api/vneid";
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
import { deleteVneid, updateVneid } from "@/server/vneid";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "vneid", "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = VneidEditForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateVneid(actor, id, parsed.data);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "vneid",
    action: "update",
    targetLabel: `VNeID cho ${result.record.customerName}`,
    targetTable: "vneid_records",
    targetId: id,
  });
  return Response.json(result.record);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "vneid", "delete")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await deleteVneid(actor, id);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });
  const removed = result.record;

  await logAudit(actor, {
    module: "vneid",
    action: "delete",
    targetLabel: `VNeID cho ${removed.customerName}`,
    targetTable: "vneid_records",
    targetId: removed.id,
  });
  return new Response(null, { status: 204 });
}

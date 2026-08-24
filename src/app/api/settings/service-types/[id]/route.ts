import { ServiceTypeForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateServiceType } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = ServiceTypeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateServiceType(id, parsed.data);
  if (!result.ok) return badRequest("Tên loại dịch vụ này đã có");
  const item = result.item;
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "services",
    action: "update",
    targetLabel: `Sửa loại dịch vụ ${item.name}`,
    targetTable: "service_types",
    targetId: id,
  });
  return Response.json(item);
}

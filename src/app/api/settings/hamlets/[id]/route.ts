import { HamletRenameForm } from "@/lib/api/wardCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { deleteHamlet, renameHamlet } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = HamletRenameForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await renameHamlet(id, parsed.data.name);
  if (!result.ok) return badRequest("Xã này đã có ấp trùng tên");
  const item = result.item;
  if (!item) return notFound();
  const province = item.province;
  if (!province) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Đổi tên ấp ${item.previousName} thành ${parsed.data.name} (${province.name})`,
    targetTable: "hamlets",
    targetId: id,
  });
  return Response.json(province);
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await deleteHamlet(id);
  if (!result) return notFound();
  const province = result.province;
  if (!province) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "delete",
    targetLabel: `Xoá ấp ${result.deletedName} (${province.name})`,
    targetTable: "hamlets",
    targetId: id,
  });
  return Response.json(province);
}

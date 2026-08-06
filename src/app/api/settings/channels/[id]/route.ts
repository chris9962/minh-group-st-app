import { ChannelForm } from "@/lib/api/channelCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateChannel } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = ChannelForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateChannel(id, parsed.data);
  if (!result.ok) return badRequest("Tên kênh này đã có");
  const item = result.item;
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Sửa kênh ${item.name}`,
    targetTable: "channels",
    targetId: id,
  });
  return Response.json(item);
}

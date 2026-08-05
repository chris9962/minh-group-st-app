import { ChannelForm } from "@/lib/api/channelCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createChannel, listChannels } from "@/server/catalog";

/** P-70 · Danh mục kênh tiếp cận. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listChannels());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = ChannelForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await createChannel(parsed.data);

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm kênh ${item.name}`,
    targetTable: "channels",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}

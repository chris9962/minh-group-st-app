import { CatalogItemForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createGiftItem, listGiftItems } from "@/server/catalog";

/** P-82 · Danh mục quà tặng. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "insurance", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listGiftItems());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "insurance", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = CatalogItemForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await createGiftItem(parsed.data);

  await logAudit(guard.actor, {
    module: "insurance",
    action: "create",
    targetLabel: `Thêm món quà ${item.name}`,
    targetTable: "gift_items",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}

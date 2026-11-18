import { GiftShopForm } from "@/lib/api/giftShops";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { giftShopById, updateGiftShop } from "@/server/giftShops";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const shop = isUuid(id) ? await giftShopById(id) : null;
  return shop ? Response.json(shop) : notFound();
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = GiftShopForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateGiftShop(id, parsed.data);
  if (!result.ok) return badRequest("Tên shop này đã có");
  const item = result.item;
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Sửa shop mua quà ${item.name}`,
    targetTable: "gift_shops",
    targetId: id,
  });
  return Response.json(item);
}

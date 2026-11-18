import { GiftShopProductForm } from "@/lib/api/giftShops";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateGiftShopProduct } from "@/server/giftShops";

type Params = { params: Promise<{ id: string; productId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id, productId } = await params;
  if (!isUuid(id) || !isUuid(productId)) return notFound();

  const parsed = GiftShopProductForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateGiftShopProduct(id, productId, parsed.data);
  if (!result.ok) return badRequest("Shop này đã có sản phẩm cùng tên");
  const item = result.item;
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Sửa sản phẩm ${item.name}`,
    targetTable: "gift_shop_products",
    targetId: productId,
  });
  return Response.json(item);
}

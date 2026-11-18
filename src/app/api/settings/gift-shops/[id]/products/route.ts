import { GiftShopProductForm } from "@/lib/api/giftShops";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { createGiftShopProduct, giftShopExists, listGiftShopProducts } from "@/server/giftShops";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id) || !(await giftShopExists(id))) return notFound();
  return Response.json(await listGiftShopProducts(id));
}

export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id) || !(await giftShopExists(id))) return notFound();

  const parsed = GiftShopProductForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createGiftShopProduct(id, parsed.data);
  if (!result.ok) return badRequest("Shop này đã có sản phẩm cùng tên");
  const item = result.item;

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm sản phẩm ${item.name}`,
    targetTable: "gift_shop_products",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}

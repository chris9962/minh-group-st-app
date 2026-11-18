import { GiftShopForm } from "@/lib/api/giftShops";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createGiftShop, listGiftShops } from "@/server/giftShops";

/** Shop mua quà ShopeePay. Bước 2 đọc shop qua chi tiết tài khoản, không qua route này. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listGiftShops());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = GiftShopForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createGiftShop(parsed.data);
  if (!result.ok) return badRequest("Tên shop này đã có");
  const item = result.item;

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm shop mua quà ${item.name}`,
    targetTable: "gift_shops",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}

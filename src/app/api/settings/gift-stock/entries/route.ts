import { GiftStockEntryForm } from "@/lib/api/giftStock";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createGiftStockEntry } from "@/server/giftStock";

/** P-87 · Nhập quà vào kho quà. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = GiftStockEntryForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const entry = await createGiftStockEntry(guard.actor.id, parsed.data);
  if (!entry) return badRequest("Món quà này không còn trong danh mục");

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Nhập quà ${entry.itemName}: ${entry.quantity}`,
    targetTable: "gift_stock_entries",
    targetId: entry.id,
  });
  return Response.json(entry, { status: 201 });
}

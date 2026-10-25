import { GiftStockEntryUpdate } from "@/lib/api/giftStock";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateGiftStockEntry } from "@/server/giftStock";

type Params = { params: Promise<{ id: string }> };

/** P-87 · Sửa một lần nhập quà. Nhật ký giữ số cũ, vì dòng nhập chỉ lưu số mới. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = GiftStockEntryUpdate.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateGiftStockEntry(id, parsed.data);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Sửa lần nhập ${result.entry.itemName}: ${result.previousQuantity} → ${result.entry.quantity}`,
    targetTable: "gift_stock_entries",
    targetId: id,
  });
  return Response.json(result.entry);
}

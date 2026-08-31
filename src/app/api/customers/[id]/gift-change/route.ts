import { GiftChangeForm } from "@/lib/api/customers";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { changeGift } from "@/server/gift";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "grant-gift")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = GiftChangeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  const result = await changeGift(actor, id, parsed.data);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(actor, {
    module: "banking",
    action: "grant-gift",
    targetLabel: `Đổi quà ${result.customerName}: ${result.fromLabel} → ${result.toLabel} · ${parsed.data.reason}`,
    targetTable: "gift_grants",
    targetId: result.grantId,
  });
  return Response.json({ ok: true });
}

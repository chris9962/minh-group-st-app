import { BankForm } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateBank } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "banking", "manage-bank-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = BankForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateBank(id, parsed.data);
  if (!result) return notFound();
  if (!result.ok) return badRequest("Mã ngân hàng này đã có");

  await logAudit(guard.actor, {
    module: "banking",
    action: "update",
    targetLabel: `Sửa ngân hàng ${result.item.code}`,
    targetTable: "banks",
    targetId: id,
  });
  return Response.json(result.item);
}

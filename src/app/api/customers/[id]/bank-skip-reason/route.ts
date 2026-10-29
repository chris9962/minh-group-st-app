import { BankSkipReasonForm } from "@/lib/api/customers";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { logAudit } from "@/server/audit";
import { saveBankSkipReason } from "@/server/bankSkipReason";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actorWith(request, "customer", "update");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = BankSkipReasonForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);
  const result = await saveBankSkipReason(guard.actor, id, parsed.data);
  if (!result) return notFound();
  if (!result.ok) return badRequest(result.message);
  await logAudit(guard.actor, {
    module: "customer", action: "update",
    targetLabel: `Ghi lý do không mở bank ưu tiên cho ${result.fullName}`,
    targetTable: "bank_skip_reasons", targetId: id,
  });
  return Response.json(result.reason);
}

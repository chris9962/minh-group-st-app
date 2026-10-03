import { BankAccountMoveForm } from "@/lib/api/bankAccounts";
import { isFullAccess } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorPassing, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { moveBankAccount, moveTargets } from "@/server/transfers";

/** Hồ sơ khách nhận được tài khoản này, cho ô tìm của hộp thoại đổi khách. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actorPassing(request, (actor) => isFullAccess(actor.permissions));
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const search = new URL(request.url).searchParams.get("search") ?? "";
  const result = await moveTargets(guard.actor, id, search);
  return result ? Response.json(result) : notFound();
}

/** Đổi tài khoản sang hồ sơ khách khác của cùng người tạo. Chỉ tài khoản toàn quyền. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actorPassing(request, (actor) => isFullAccess(actor.permissions));
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = BankAccountMoveForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Chưa chọn khách nhận");

  const result = await moveBankAccount(id, parsed.data.customerId);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const { bankCode, fromName, toName } = result.value;
  await logAudit(guard.actor, {
    module: "banking",
    action: "update",
    targetLabel: `Đổi khách cho tài khoản ${bankCode} từ ${fromName} sang ${toName}`,
    targetTable: "bank_accounts",
    targetId: id,
  });
  return Response.json({ ok: true });
}

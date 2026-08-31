import { BankAccountStatusUpdateForm } from "@/lib/api/bankAccounts";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { updateBankAccountStatus } from "@/server/banking";

/** Đối soát tài khoản: lỗi thì loại khỏi KPI, khôi phục thì tính lại KPI. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = BankAccountStatusUpdateForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  const result = await updateBankAccountStatus(actor, id, parsed.data);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const account = result.value;
  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel:
      account.status === "error"
        ? `Đánh dấu lỗi tài khoản ${account.bankCode} của ${account.customerName}: ${account.errorNote}`
        : `Khôi phục tài khoản ${account.bankCode} của ${account.customerName} về hoàn thành`,
    targetTable: "bank_accounts",
    targetId: account.id,
  });
  return Response.json(account);
}

import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { restoreAccountByBankManager } from "@/server/banking";

type Params = { params: Promise<{ id: string; accountId: string }> };

/**
 * Khôi phục tài khoản lỗi về hoàn thành từ trang chi tiết ngân hàng và P-22,
 * `Lỗi` → `Hoàn thành`. Cùng chốt quyền với route `error` bên cạnh: KHÔNG gác
 * `banking:update`, người quản ngân hàng thường không có quyền đó; chốt nằm ở
 * `restoreAccountByBankManager`, đọc `canManageBank` theo ngân hàng của tài khoản.
 */
export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id, accountId } = await params;
  if (!isUuid(id) || !isUuid(accountId)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const result = await restoreAccountByBankManager(actor, accountId);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const account = result.value;
  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Khôi phục tài khoản ${account.bankCode} của ${account.customerName} về hoàn thành`,
    targetTable: "bank_accounts",
    targetId: account.id,
  });
  return Response.json(account);
}

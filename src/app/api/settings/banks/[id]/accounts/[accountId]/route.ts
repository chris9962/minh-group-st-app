import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { bankAccountDetailOfBank, deleteCreatingAccountByBankManager } from "@/server/banking";

type Params = { params: Promise<{ id: string; accountId: string }> };

/**
 * Chi tiết một tài khoản trong trang chi tiết ngân hàng — cùng chốt phân quyền
 * với route `/accounts` bên cạnh: `canManageBank`, không kẹp phạm vi phòng.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id, accountId } = await params;
  if (!isUuid(id) || !isUuid(accountId)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const detail = await bankAccountDetailOfBank(id, accountId);
  if (!detail) return notFound();
  return Response.json(detail);
}

/**
 * Xoá một tài khoản ĐANG TẠO từ trang chi tiết ngân hàng — người quản ngân
 * hàng dọn bản nháp bỏ dở của người khác (chốt 2026-09-12).
 *
 * `id` trong đường dẫn chỉ để kiểm sớm; chốt quyền thật nằm trong
 * `deleteCreatingAccountByBankManager`, đọc `canManageBank` theo đúng ngân
 * hàng của tài khoản.
 */
export async function DELETE(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id, accountId } = await params;
  if (!isUuid(id) || !isUuid(accountId)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const result = await deleteCreatingAccountByBankManager(actor, accountId);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const removed = result.value;
  await logAudit(actor, {
    module: "banking",
    action: "delete",
    targetLabel: `Bỏ dở tài khoản ${removed.bankCode} của ${removed.customerName}, nhả mã ${removed.referralCode}`,
    targetTable: "bank_accounts",
    targetId: removed.id,
  });
  return new Response(null, { status: 204 });
}

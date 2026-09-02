import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { bankAccountDetailOfBank } from "@/server/banking";

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

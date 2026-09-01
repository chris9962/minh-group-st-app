import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { listBankReferralCodeOptions } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

/**
 * Tên mã của một ngân hàng, cho ô lọc ở trang chi tiết ngân hàng.
 *
 * Route riêng chứ không dùng `/api/settings/referral-codes/options`: route đó
 * gác bằng `banking:view-summary` và trả mã của mọi ngân hàng. Người quản một
 * ngân hàng thường không có quyền đó, mà cũng không cần mã của ngân hàng khác.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  return Response.json(await listBankReferralCodeOptions(id));
}

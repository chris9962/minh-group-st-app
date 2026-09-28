import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { photoCheckStatsOfBank } from "@/server/photoCheckStats";

type Params = { params: Promise<{ id: string }> };

/**
 * Tab Hiệu suất kiểm ảnh của trang chi tiết ngân hàng — cùng chốt phân quyền
 * với route `/accounts` bên cạnh: `canManageBank`, không kẹp phạm vi phòng.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const query = new URL(request.url).searchParams;
  return Response.json(
    await photoCheckStatsOfBank(id, query.get("from") ?? "", query.get("to") ?? ""),
  );
}

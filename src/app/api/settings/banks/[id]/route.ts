import { BankForm } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { can, canManageBank } from "@/lib/permissions";
import { actorWith, badRequest, forbidden, isUuid, jsonBody, notFound } from "@/server/auth";
import { bankManagerIds, updateBank } from "@/server/catalog";

/**
 * Danh sách người quản chỉ nhận từ người có `grant-permission`.
 *
 * Người khác gửi lên thì BỎ QUA và giữ nguyên danh sách đang có — không trả
 * lỗi, vì ô đó đã ẩn ở giao diện nên đây là chốt chặn phía máy chủ, không phải
 * đường người dùng đi tới được (AGENTS.md §6).
 *
 * ⚠️ Người quản một ngân hàng KHÔNG tự thêm người vào ngân hàng mình quản. Cho
 * phép là mở đường tự nới quyền: họ thêm chính mình vào ngân hàng khác.
 */
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "manage-bank");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  /**
   * Ngân hàng này có nằm trong phạm vi người gọi không.
   *
   * `manage-bank` mở màn, `canManageBank` mở đúng ngân hàng — hai câu hỏi khác
   * nhau, và thiếu câu thứ hai thì ai vào được màn cũng sửa được cả 13 ngân hàng.
   */
  if (!canManageBank(guard.actor, id)) return forbidden();

  const parsed = BankForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const form = can(guard.actor, "system", "grant-permission")
    ? parsed.data
    : { ...parsed.data, managerIds: await bankManagerIds(id) };

  const result = await updateBank(id, form);
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

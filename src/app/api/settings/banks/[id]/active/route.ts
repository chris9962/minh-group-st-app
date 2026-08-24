import { z } from "zod";
import { logAudit } from "@/server/audit";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { actorWith, badRequest, forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { setBankActive } from "@/server/catalog";

/**
 * Gác nhóm màn quản lý ngân hàng — nhận CẢ hai quyền.
 *
 * `manage-bank` mở với mọi ngân hàng, `manage-assigned-banks` mở với những
 * ngân hàng được giao. Chốt phạm vi theo từng ngân hàng nằm ở `canManageBank`,
 * không phải ở đây.
 */
async function bankAdminGuard(request: Request) {
  const actor = await getActor(request);
  if (!actor) return { ok: false as const, response: unauthorized() };
  if (!canOpenBankAdmin(actor)) return { ok: false as const, response: forbidden() };
  return { ok: true as const, actor };
}

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

/** Ngừng / mở lại — KHÔNG xoá. Bản ghi cũ trỏ vào id, xoá là để lại id chết. */
export async function POST(request: Request, { params }: Params) {
  const guard = await bankAdminGuard(request);
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

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await setBankActive(id, parsed.data.active);
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "banking",
    action: "update",
    targetLabel: `${parsed.data.active ? "Mở lại" : "Ngừng"} ngân hàng ${item.code}`,
    targetTable: "banks",
    targetId: id,
  });
  return Response.json(item);
}

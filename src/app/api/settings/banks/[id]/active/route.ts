import { z } from "zod";
import { logAudit } from "@/server/audit";
import { canManageBank } from "@/lib/permissions";
import { actorWith, badRequest, forbidden, isUuid, jsonBody, notFound } from "@/server/auth";
import { setBankActive } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

/** Ngừng / mở lại — KHÔNG xoá. Bản ghi cũ trỏ vào id, xoá là để lại id chết. */
export async function POST(request: Request, { params }: Params) {
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

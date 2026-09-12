import { logAudit } from "@/server/audit";
import { getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { setPhotoCheckConfirmed } from "@/server/photoCheck";

/**
 * Người duyệt xác nhận ảnh đạt trên lượt xác thực mới nhất (`POST`), hoặc bỏ
 * xác nhận (`DELETE`).
 *
 * Chốt quyền nằm trong `setPhotoCheckConfirmed`: `canManageBank` theo đúng ngân
 * hàng của tài khoản. Ngoài quyền trả 404, không phải 403 — 403 xác nhận id có
 * thật.
 */
async function handle(request: Request, params: Promise<{ id: string }>, confirmed: boolean) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await setPhotoCheckConfirmed(actor, id, confirmed);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: confirmed ? "Xác nhận ảnh tài khoản đạt" : "Bỏ xác nhận ảnh tài khoản đạt",
    targetTable: "bank_accounts",
    targetId: id,
  });
  return Response.json({ ok: true });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(request, ctx.params, true);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(request, ctx.params, false);
}

import { z } from "zod";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { bankIdOfReferralCode, setReferralCodeActive } from "@/server/catalog";

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

/**
 * P-61 · Ngừng / dùng lại một mã — KHÔNG xoá. Tài khoản đã mở trỏ vào mã bằng
 * id, xoá là để lại id chết. Trước đây mã chỉ dừng khi tiêu hết `total`.
 */
export async function POST(request: Request, { params }: Params) {
  const guard = await bankAdminGuard(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Chốt phạm vi đọc ngân hàng THẬT của mã — cùng lý do với đường PATCH.
  const bankId = await bankIdOfReferralCode(id);
  if (!bankId) return notFound();
  if (!canManageBank(guard.actor, bankId)) return forbidden();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await setReferralCodeActive(id, parsed.data.active);
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "banking",
    action: "update",
    targetLabel: `${parsed.data.active ? "Dùng lại" : "Ngừng"} mã giới thiệu ${item.code}`,
    targetTable: "referral_codes",
    targetId: id,
  });
  return Response.json(item);
}

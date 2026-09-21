import { z } from "zod";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { changeReferralCodeByBankManager, usableCodesForAccount } from "@/server/banking";

type Params = { params: Promise<{ id: string; accountId: string }> };

const Form = z.object({
  referralCodeId: z.guid("Chưa chọn mã giới thiệu"),
});

/**
 * Đổi mã giới thiệu của một tài khoản từ trang chi tiết ngân hàng (chốt
 * 2026-09-20). Gác quyền như `error/route.ts`: `canManageBank` theo ngân hàng
 * của tài khoản, không đòi `banking:update`.
 *
 * GET trả danh sách mã đổi được, lọc theo phòng và loại của chính tài khoản.
 * PATCH đổi sang mã đã chọn; chốt còn chỗ nằm trong transaction ở
 * `changeReferralCodeByBankManager`.
 */
async function guard(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return { response: unauthorized() };
  if (!canOpenBankAdmin(actor)) return { response: forbidden() };

  const { id, accountId } = await params;
  if (!isUuid(id) || !isUuid(accountId)) return { response: notFound() };
  if (!canManageBank(actor, id)) return { response: forbidden() };
  return { actor, accountId };
}

export async function GET(request: Request, ctx: Params) {
  const g = await guard(request, ctx);
  if ("response" in g) return g.response;

  const codes = await usableCodesForAccount(g.actor, g.accountId);
  if (!codes) return notFound();
  return Response.json(codes);
}

export async function PATCH(request: Request, ctx: Params) {
  const g = await guard(request, ctx);
  if ("response" in g) return g.response;

  const parsed = Form.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  // Ngoài quyền quản ngân hàng trả 404, không phải 403 — 403 xác nhận id có thật.
  const result = await changeReferralCodeByBankManager(g.actor, g.accountId, parsed.data.referralCodeId);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const account = result.value;
  await logAudit(g.actor, {
    module: "banking",
    action: "update",
    targetLabel: `Đổi mã giới thiệu tài khoản ${account.bankCode} của ${account.customerName} sang ${account.referralCode}`,
    targetTable: "bank_accounts",
    targetId: account.id,
  });
  return Response.json(account);
}

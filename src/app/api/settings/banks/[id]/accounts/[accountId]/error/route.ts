import { z } from "zod";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { markAccountErrorByBankManager } from "@/server/banking";

type Params = { params: Promise<{ id: string; accountId: string }> };

const Form = z.object({
  errorNote: z.string().trim().min(2, "Nhập lý do đánh dấu lỗi").max(500, "Lý do nhiều nhất 500 ký tự"),
});

/**
 * Đánh dấu lỗi một tài khoản từ trang chi tiết ngân hàng — `Hoàn thành` → `Lỗi`.
 *
 * KHÔNG gác `banking:update`: người quản ngân hàng thường không có quyền đó, hoặc
 * có ở phạm vi `creator` nên không đụng được tài khoản của nhân viên khác. Chốt
 * quyền nằm trong `markAccountErrorByBankManager`, đọc `canManageBank` theo đúng
 * ngân hàng của tài khoản; `id` trong đường dẫn chỉ để kiểm sớm.
 */
export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id, accountId } = await params;
  if (!isUuid(id) || !isUuid(accountId)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const parsed = Form.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  // Ngoài quyền quản ngân hàng trả 404, không phải 403 — 403 xác nhận id có thật.
  const result = await markAccountErrorByBankManager(actor, accountId, parsed.data.errorNote);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const account = result.value;
  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Đánh dấu lỗi tài khoản ${account.bankCode} của ${account.customerName}: ${account.errorNote}`,
    targetTable: "bank_accounts",
    targetId: account.id,
  });
  return Response.json(account);
}

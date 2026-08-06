import { BankAccountFinishForm } from "@/lib/api/bankAccounts";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import {
  badRequest,
  forbidden,
  getActor,
  isUuid,
  jsonBody,
  notFound,
  unauthorized,
} from "@/server/auth";
import { finishBankAccount } from "@/server/banking";

/**
 * P-22 bước 2 — điền nốt rồi Hoàn thành. Lúc này mã mới thật sự bị tiêu và
 * điểm KPI mới tính.
 *
 * Thiếu ảnh là chốt CỨNG duy nhất của module (spec §4.8 luật 4) và trả 422 kèm
 * câu nói rõ thiếu mấy tấm. Ba luật còn lại chỉ là cảnh báo mềm, đi kèm trong
 * phần trả về sau khi đã lưu xong.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = BankAccountFinishForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await finishBankAccount(actor, id, parsed.data);
  // `null` = không có hoặc ngoài tầm nhìn — 404 giống hệt nhau.
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Hoàn thành tài khoản ${result.value.account.bankCode} của ${result.value.account.customerName}`,
    targetTable: "bank_accounts",
    targetId: id,
  });
  return Response.json(result.value);
}

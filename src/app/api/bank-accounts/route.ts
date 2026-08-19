import { BankAccountStartForm } from "@/lib/api/bankAccounts";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { startBankAccount } from "@/server/banking";

/**
 * P-20 bước 1 — giữ chỗ mã giới thiệu và tạo bản ghi `creating`.
 *
 * Người tạo lấy từ phiên đăng nhập, không nhận từ body: `actorId` do client gửi
 * là đường ghi công của mình vào tên người khác.
 */
export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "create")) return forbidden();

  const parsed = BankAccountStartForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await startBankAccount(actor, parsed.data);
  // 409 chứ không phải 422: "mã vừa hết chỗ" là XUNG ĐỘT với người khác, không
  // phải dữ liệu người này nhập sai. Giao diện đọc câu của máy chủ để hiện.
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(actor, {
    module: "banking",
    action: "create",
    targetLabel: `Giữ chỗ mã ${result.value.referralCode} (${result.value.bankCode}) cho ${result.value.customerName}`,
    targetTable: "bank_accounts",
    targetId: result.value.id,
  });
  return Response.json(result.value, { status: 201 });
}

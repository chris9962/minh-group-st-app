import { BankAccountStartForm } from "@/lib/api/bankAccounts";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { startBankAccount } from "@/server/banking";

/**
 * P-20 bước giữ chỗ — giữ chỗ mã giới thiệu và tạo bản ghi `creating`.
 *
 * MỘT lượt gọi tạo 1–3 tài khoản, mỗi ngân hàng một dòng. Trả về mảng, kể cả khi
 * chỉ có một dòng: nơi gọi luôn đọc cùng một hình dạng.
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

  // Một dòng nhật ký cho MỖI tài khoản, không gộp cả lượt: P-93 tra theo
  // `targetId`, gộp thì hai tài khoản trong cùng lượt không tra ra được.
  for (const account of result.value)
    await logAudit(actor, {
      module: "banking",
      action: "create",
      targetLabel: `Giữ chỗ mã ${account.referralCode} (${account.bankCode}) cho ${account.customerName}`,
      targetTable: "bank_accounts",
      targetId: account.id,
    });
  return Response.json(result.value, { status: 201 });
}

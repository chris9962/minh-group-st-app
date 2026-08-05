import { ReferralCodeForm } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createReferralCode, listReferralCodes } from "@/server/catalog";

/**
 * P-61 · Kho mã giới thiệu.
 *
 * ⚠️ Bảng này RỖNG là cả module ngân hàng đứng: `bank_accounts.referral_code_id`
 * là `NOT NULL`, không mở nổi một tài khoản nào khi chưa có mã. Mã là mã thật
 * ngân hàng cấp, có số lượng — không seed được, phải nhập.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "banking", "manage-referral-codes");
  if (!guard.ok) return guard.response;

  // `status` lọc ở giao diện: nó suy ra từ used/holding/total nên tính ở đây là
  // lặp lại công thức `codeStatusOf` ở hai nơi, sớm muộn hai nơi lệch nhau.
  const bankId = new URL(request.url).searchParams.get("bankId") ?? "";
  return Response.json(await listReferralCodes(bankId));
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "banking", "manage-referral-codes");
  if (!guard.ok) return guard.response;

  const parsed = ReferralCodeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createReferralCode(parsed.data);
  if (!result.ok) return badRequest("Mã này đã có trong kho của ngân hàng đó");

  await logAudit(guard.actor, {
    module: "banking",
    action: "create",
    targetLabel: `Thêm mã giới thiệu ${result.item.code}`,
    targetTable: "referral_codes",
    targetId: result.item.id,
  });
  return Response.json(result.item, { status: 201 });
}

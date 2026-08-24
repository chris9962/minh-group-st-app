import { CodeStatus, REFERRAL_CODE_SORT, ReferralCodeForm } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, uuidParam } from "@/server/auth";
import { createReferralCode, listReferralCodes } from "@/server/catalog";
import { pageArgsFrom } from "@/server/pagination";

/**
 * P-61 · Kho mã giới thiệu.
 *
 * ⚠️ Bảng này RỖNG là cả module ngân hàng đứng: `bank_accounts.referral_code_id`
 * là `NOT NULL`, không mở nổi một tài khoản nào khi chưa có mã. Mã là mã thật
 * ngân hàng cấp, có số lượng — không seed được, phải nhập.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "manage-referral-codes");
  if (!guard.ok) return guard.response;

  // Lọc · tìm · sắp · cắt trang đều ở máy chủ (AGENTS.md §5.1). Trạng thái lạ
  // thì bỏ bộ lọc chứ không trả 400 — không nên vì một tham số gõ sai mà bắt
  // người dùng nhìn màn hỏng.
  const params = new URL(request.url).searchParams;
  const status = CodeStatus.safeParse(params.get("status"));

  return Response.json(
    await listReferralCodes(
      {
        // uuid sai dạng đi thẳng vào SQL là lỗi cast của Postgres → 500 màn
        // trắng. Bỏ bộ lọc, cùng cách đang xử lý `status` lạ ngay dưới.
        bankId: uuidParam(params.get("bankId")),
        status: status.success ? status.data : "",
        search: (params.get("search") ?? "").trim(),
      },
      pageArgsFrom(new URL(request.url), REFERRAL_CODE_SORT, "progress"),
    ),
  );
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "manage-referral-codes");
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

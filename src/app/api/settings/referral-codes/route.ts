import { CodeStatus, REFERRAL_CODE_SORT, ReferralCodeForm } from "@/lib/api/bankCatalog";
import { canManageBank, canOpenBankAdmin, visibleBankIds } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, forbidden, getActor, jsonBody, unauthorized, uuidParam } from "@/server/auth";
import { createReferralCode, listReferralCodes } from "@/server/catalog";
import { pageArgsFrom } from "@/server/pagination";

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

/**
 * P-61 · Kho mã giới thiệu.
 *
 * ⚠️ Bảng này RỖNG là cả module ngân hàng đứng: `bank_accounts.referral_code_id`
 * là `NOT NULL`, không mở nổi một tài khoản nào khi chưa có mã. Mã là mã thật
 * ngân hàng cấp, có số lượng — không seed được, phải nhập.
 */
export async function GET(request: Request) {
  const guard = await bankAdminGuard(request);
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
        departmentId: uuidParam(params.get("departmentId")),
        status: status.success ? status.data : "",
        search: (params.get("search") ?? "").trim(),
        // Phạm vi quyền, không phải bộ lọc người dùng chọn — xem `ReferralCodeFilters`.
        allowedBankIds: visibleBankIds(guard.actor),
      },
      pageArgsFrom(new URL(request.url), REFERRAL_CODE_SORT, "progress"),
    ),
  );
}

export async function POST(request: Request) {
  const guard = await bankAdminGuard(request);
  if (!guard.ok) return guard.response;

  const parsed = ReferralCodeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  // Mã thuộc về một ngân hàng, nên chốt phạm vi đi theo ngân hàng của mã.
  if (!canManageBank(guard.actor, parsed.data.bankId)) return forbidden();

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

import { z } from "zod";
import { CodeStatus } from "@/lib/api/bankCatalog";
import { canManageBank, canOpenBankAdmin, visibleBankIds } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, notFound, unauthorized, uuidParam } from "@/server/auth";
import {
  listActiveReferralCodesForBulkStop,
  referralCodesForBulkPermission,
  stopReferralCodesBulk,
} from "@/server/catalog";

async function bankAdminGuard(request: Request) {
  const actor = await getActor(request);
  if (!actor) return { ok: false as const, response: unauthorized() };
  if (!canOpenBankAdmin(actor)) return { ok: false as const, response: forbidden() };
  return { ok: true as const, actor };
}

/** Danh sách rút gọn, giữ nguyên bộ lọc của bảng nhưng chỉ lấy mã đang dùng. */
export async function GET(request: Request) {
  const guard = await bankAdminGuard(request);
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const status = CodeStatus.safeParse(params.get("status"));
  const rows = await listActiveReferralCodesForBulkStop({
    bankId: uuidParam(params.get("bankId")),
    departmentId: uuidParam(params.get("departmentId")),
    status: status.success ? status.data : "",
    search: (params.get("search") ?? "").trim(),
    allowedBankIds: visibleBankIds(guard.actor),
  });

  return Response.json(
    rows.map(({ id, bankCode, displayName }) => ({ id, bankCode, displayName })),
  );
}

const Body = z.object({ ids: z.array(z.guid()).min(1).max(2_000) });

/** Ngừng cả nhóm bằng một UPDATE sau khi kiểm phạm vi của từng mã. */
export async function POST(request: Request) {
  const guard = await bankAdminGuard(request);
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Chọn ít nhất một mã để ngừng");
  const ids = [...new Set(parsed.data.ids)];
  const codes = await referralCodesForBulkPermission(ids);
  if (codes.length !== ids.length) return notFound();
  if (codes.some((code) => !canManageBank(guard.actor, code.bankId))) return forbidden();

  const stopped = await stopReferralCodesBulk(ids);
  await logAudit(guard.actor, {
    module: "banking",
    action: "update",
    targetLabel: `Ngừng hàng loạt ${stopped} mã giới thiệu`,
    targetTable: "referral_codes",
  });

  return Response.json({ stopped });
}

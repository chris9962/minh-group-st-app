import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listBankAccountsForExport } from "@/server/banking";

/**
 * TRỌN danh sách tài khoản khớp bộ lọc, cho màn Xuất dữ liệu.
 *
 * Đường riêng, gác bằng `banking:export` — không mở tham số "lấy hết" trên
 * route danh sách đã phân trang (AGENTS.md §5.1, điều 4).
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const result = await listBankAccountsForExport(actor, {
    search: params.get("search") ?? "",
    bankCode: params.get("bankCode") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    referralCode: params.get("referralCode") ?? "",
    channelId: uuidParam(params.get("channelId")),
    staffId: uuidParam(params.get("staffId")),
    departmentId: uuidParam(params.get("departmentId")),
    status: params.get("status") ?? "",
    accountType: params.get("accountType") ?? "",
  });

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Tài khoản ngân hàng · ${result.rows.length}/${result.total} dòng`,
  });

  return Response.json(result);
}

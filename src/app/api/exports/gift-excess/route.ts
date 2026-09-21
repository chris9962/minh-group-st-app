import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listGiftExcessExport } from "@/server/giftExcess";

/**
 * P-73 báo cáo #6 · Quà cấp dư do app lỗi.
 *
 * Gác bằng `banking:export`: quà sinh từ combo tài khoản ngân hàng, cùng module
 * với P-44. Mỗi dòng mang tên và CCCD khách nên `listGiftExcessExport` kẹp thêm
 * phạm vi xuất của người gọi.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const result = await listGiftExcessExport(actor, {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    staffId: uuidParam(params.get("staffId")),
    departmentId: uuidParam(params.get("departmentId")),
    bankCode: params.get("bankCode") ?? "",
  });

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Quà cấp dư do app lỗi - ${result.rows.length} khách, xét ${result.scanned}/${result.total}`,
  });

  return Response.json(result);
}

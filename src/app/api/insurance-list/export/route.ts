import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listInsuranceOrdersForExport } from "@/server/insurance";

/**
 * TRỌN danh sách đơn bảo hiểm khớp bộ lọc, cho màn Xuất dữ liệu (báo cáo #6).
 *
 * Đường riêng, gác bằng `insurance:export` — không mở tham số "lấy hết" trên
 * route danh sách đã phân trang (AGENTS.md §5.1, điều 4).
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const result = await listInsuranceOrdersForExport(actor, {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    staffRole: params.get("staffRole") ?? "any",
    product: params.get("product") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    staffId: uuidParam(params.get("staffId")),
    departmentId: uuidParam(params.get("departmentId")),
    handler: params.get("handler") ?? "",
  });

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "insurance",
    action: "export",
    targetLabel: `Đơn bảo hiểm · ${result.rows.length}/${result.total} dòng`,
  });

  return Response.json(result);
}

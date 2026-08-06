import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listServicesForExport } from "@/server/services";

/**
 * TRỌN danh sách dịch vụ khớp bộ lọc, cho màn Xuất dữ liệu.
 *
 * Đường riêng, gác bằng `services:export` — không mở tham số "lấy hết" trên
 * route danh sách đã phân trang (AGENTS.md §5.1, điều 4).
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "services", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const result = await listServicesForExport(actor, {
    search: params.get("search") ?? "",
    serviceTypeId: uuidParam(params.get("serviceTypeId")),
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    wardId: uuidParam(params.get("wardId")),
    staffId: uuidParam(params.get("staffId")),
  });

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "services",
    action: "export",
    targetLabel: `Dịch vụ · ${result.rows.length}/${result.total} dòng`,
  });

  return Response.json(result);
}

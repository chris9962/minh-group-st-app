import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listGiftGrantsForExport } from "@/server/gift";

/**
 * TRỌN danh sách quà đã phát khớp bộ lọc, cho nút Xuất Excel của P-44.
 *
 * Đường riêng, gác bằng `banking:export` — không mở tham số "lấy hết" trên
 * route danh sách đã phân trang (AGENTS.md §5.1, điều 4).
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "export")) return forbidden();

  const params = new URL(request.url).searchParams;

  const result = await listGiftGrantsForExport(actor, {
    search: params.get("search") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    departmentId: uuidParam(params.get("departmentId")),
    staffId: uuidParam(params.get("staffId")),
  });

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Quà đã phát · ${result.rows.length}/${result.total} dòng`,
  });

  return Response.json(result);
}

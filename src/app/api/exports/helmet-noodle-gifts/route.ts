import { HelmetNoodleItem } from "@/lib/api/exports";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listHelmetNoodleExport } from "@/server/gift";

/**
 * Màn Xuất dữ liệu · Khách đã nhận Nón, Mì (thêm 2026-10-21).
 *
 * Gác `banking:export`, cùng quyền với nút Xuất của danh sách Quà đã phát. CCCD
 * trả số đầy đủ nên chỉ đi ra khi người xuất có `customer:access-id-number`,
 * cùng luật với báo cáo Tính điểm tổng.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const item = HelmetNoodleItem.safeParse(params.get("item"));
  const result = await listHelmetNoodleExport(actor, {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    departmentId: uuidParam(params.get("departmentId")),
    staffId: uuidParam(params.get("staffId")),
    item: item.success ? item.data : "",
  });

  const rows = can(actor, "customer", "access-id-number")
    ? result.rows
    : result.rows.map((r) => ({ ...r, idNumber: "" }));

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Khách đã nhận Nón, Mì - ${rows.length}/${result.total} khách`,
  });

  return Response.json({ rows, total: result.total });
}

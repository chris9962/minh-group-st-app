import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { listVneidForExport, vneidFiltersFrom } from "@/server/vneid";

/** TRỌN danh sách khớp bộ lọc cho màn Xuất dữ liệu — đường riêng, gác bằng `vneid:export`. */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "vneid", "export")) return forbidden();

  const result = await listVneidForExport(actor, vneidFiltersFrom(new URL(request.url).searchParams));

  await logAudit(actor, {
    module: "vneid",
    action: "export",
    targetLabel: `VNeID · ${result.rows.length}/${result.total} dòng`,
  });
  return Response.json(result);
}

import { scopeFor, visibleDepartmentIds } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { isYearMonth } from "@/server/people";
import { listWorkDayExport } from "@/server/workDays";

/**
 * P-73 báo cáo #7 · Ngày công của mọi người trong công ty, trừ Giám đốc và Phó
 * giám đốc.
 *
 * Gác bằng `staff:export`. File kẹp theo phạm vi của quyền đó: Trưởng phòng chỉ
 * tải được phòng mình quản (chốt 2026-10-30).
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  const scope = scopeFor(actor, "staff", "export");
  if (!scope) return forbidden();

  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  if (!isYearMonth(month)) return badRequest("Tháng không hợp lệ");

  const rows = await listWorkDayExport(
    month,
    uuidParam(params.get("departmentId")),
    visibleDepartmentIds(actor, scope),
  );

  await logAudit(actor, {
    module: "staff",
    action: "export",
    targetLabel: `Ngày công ${month} · ${rows.length} dòng`,
  });

  return Response.json(rows);
}

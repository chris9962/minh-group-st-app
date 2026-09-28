import { scopeFor } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { isYearMonth } from "@/server/people";
import { listWorkDayExport } from "@/server/workDays";

/**
 * P-73 báo cáo #7 · Ngày công của mọi người trong công ty, trừ Giám đốc và Phó
 * giám đốc.
 *
 * Gác bằng `staff:export` phạm vi `company`. File không kẹp theo phòng, nên
 * người chỉ xuất được nhân viên phòng mình không được tải bảng của cả công ty.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (scopeFor(actor, "staff", "export") !== "company") return forbidden();

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!isYearMonth(month)) return badRequest("Tháng không hợp lệ");

  const rows = await listWorkDayExport(month);

  await logAudit(actor, {
    module: "staff",
    action: "export",
    targetLabel: `Ngày công ${month} · ${rows.length} dòng`,
  });

  return Response.json(rows);
}

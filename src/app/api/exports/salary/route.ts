import { scopeFor } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { isYearMonth } from "@/server/people";
import { listSalaryExport } from "@/server/salaryExport";

/**
 * P-73 báo cáo #8 · Lương của Phó giám đốc, Trưởng phòng, Phó phòng, Nhân viên
 * phòng kinh doanh trong một tháng.
 *
 * Gác bằng `staff:export` phạm vi `company`, cùng luật với báo cáo Ngày công:
 * file có lương của mọi phòng.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (scopeFor(actor, "staff", "export") !== "company") return forbidden();

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!isYearMonth(month)) return badRequest("Tháng không hợp lệ");

  const rows = await listSalaryExport(month);

  await logAudit(actor, {
    module: "staff",
    action: "export",
    targetLabel: `Lương ${month} · ${rows.length} dòng`,
  });

  return Response.json(rows);
}

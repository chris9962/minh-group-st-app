import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { isYearMonth } from "@/server/people";
import { listSalaryExport } from "@/server/salaryExport";

/**
 * Nút Xuất Excel ở màn Lương: lương của Phó giám đốc, Trưởng phòng, Phó phòng,
 * Nhân viên phòng kinh doanh trong một tháng. Màn Xuất dữ liệu bỏ báo cáo này
 * từ 2026-11-16.
 *
 * Gác bằng `salary:export` (chốt 2026-11-16). Quyền này không chia phạm vi vì
 * file có lương và số tài khoản nhận lương của mọi phòng.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "salary", "export")) return forbidden();

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!isYearMonth(month)) return badRequest("Tháng không hợp lệ");

  const rows = await listSalaryExport(month);

  await logAudit(actor, {
    module: "salary",
    action: "export",
    targetLabel: `Lương ${month} · ${rows.length} dòng`,
  });

  return Response.json(rows);
}

import { DirectedResult } from "@/lib/api/exports";
import { scopeFor } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { isYearMonth } from "@/server/people";
import { listDirectedExport } from "@/server/salaryExport";

/**
 * P-73 báo cáo #9 · Tài khoản định hướng của Nhân viên bị chấm chỉ tiêu trong
 * một tháng. Gác như báo cáo Lương: file có số của mọi phòng.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (scopeFor(actor, "staff", "export") !== "company") return forbidden();

  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  if (!isYearMonth(month)) return badRequest("Tháng không hợp lệ");
  // Giá trị lạ thì bỏ lọc, không trả 400: một tham số gõ sai không đáng làm hỏng cả lượt xuất.
  const result = DirectedResult.safeParse(params.get("result"));

  const rows = await listDirectedExport(month, result.success ? result.data : null);

  await logAudit(actor, {
    module: "staff",
    action: "export",
    targetLabel: `Tài khoản định hướng ${month} · ${rows.length} dòng`,
  });

  return Response.json(rows);
}

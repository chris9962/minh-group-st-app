import { can } from "@/lib/permissions";
import { DEPARTMENT_TYPE_LABEL, DepartmentType } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { isPeriod, isYearMonth, peopleForExport } from "@/server/people";

/**
 * TRỌN danh sách nhân viên kèm điểm và số đếm, cho màn Xuất dữ liệu.
 *
 * Đường riêng, gác bằng quyền `staff:export` — không mở tham số "lấy hết" trên
 * route danh sách đã phân trang (AGENTS.md §5.1, điều 4).
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const period = params.get("period") ?? "today";
  const summaryMonth = params.get("summaryMonth") ?? "";
  if (!isPeriod(period)) return badRequest("Kỳ xem không hợp lệ");
  if (summaryMonth && !isYearMonth(summaryMonth)) return badRequest("Tháng không hợp lệ");

  const departmentType = params.get("departmentType") ?? "";

  const rows = await peopleForExport(actor, {
    scope: params.get("scope") ?? "",
    period,
    summaryMonth,
    departmentId: uuidParam(params.get("departmentId")),
    departmentType,
    search: params.get("search") ?? "",
  });

  // Lượt xuất nào cũng để lại vết (spec §10.4): đây là bảng thành tích của cả
  // công ty, không truy được ai tải thì P-93 mất nghĩa.
  // Ghi cả bộ lọc loại phòng: hai lượt xuất cùng tháng ra số dòng khác nhau,
  // không ghi thì dòng nhật ký trông như số liệu đổi giữa hai lượt.
  const typeNote = DepartmentType.safeParse(departmentType).success
    ? ` · ${DEPARTMENT_TYPE_LABEL[departmentType as DepartmentType]}`
    : "";
  await logAudit(actor, {
    module: "staff",
    action: "export",
    targetLabel: `Nhân viên và điểm ${summaryMonth || period}${typeNote} · ${rows.length} dòng`,
  });

  return Response.json(rows);
}

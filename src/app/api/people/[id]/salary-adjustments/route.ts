import { SALARY_ADJUSTMENT_LABEL, SalaryAdjustmentForm } from "@/lib/api/salaryAdjustments";
import { formatVnd } from "@/lib/format";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { closedMonthMessage } from "@/server/closedMonths";
import { salaryVisibleStaffId } from "@/server/people";
import { salaryForUsers } from "@/server/salary";
import { createSalaryAdjustment } from "@/server/salaryAdjustments";

type Params = { params: Promise<{ id: string }> };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Ứng, thưởng, trừ của một người trong tháng. Ai xem được lương người đó thì đọc được. */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "salary", "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return badRequest("Tháng không hợp lệ");
  if (!(await salaryVisibleStaffId(actor, id, month))) return notFound();

  // Tháng đã chốt đọc bản chụp lúc chốt, tháng chưa chốt đọc bảng.
  return Response.json((await salaryForUsers([id], month)).get(id)?.adjustments ?? []);
}

/** Ghi một lần ứng, thưởng hoặc trừ lương. Cùng quyền với nút Chốt lương. */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "salary", "close-salary");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = SalaryAdjustmentForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();
  // Từ 2026-11-01 ứng trước chỉ sinh ra từ yêu cầu tạm ứng đã chi, xem `server/salaryAdvances.ts`.
  if (parsed.data.kind === "advance") return badRequest("Lương ứng trước ghi qua trang Tạm ứng lương.");
  if (parsed.data.kind === "meal") return badRequest("Lương ăn ca ghi qua trang Lương ăn ca.");

  const result = await createSalaryAdjustment(guard.actor, id, parsed.data);
  if (result === "closed") return badRequest(closedMonthMessage(parsed.data.month));
  if (!result) return notFound();

  await logAudit(guard.actor, {
    module: "salary",
    action: "close-salary",
    targetLabel: `${SALARY_ADJUSTMENT_LABEL[parsed.data.kind]} ${formatVnd(parsed.data.amount)} tháng ${parsed.data.month} cho ${result.staff.fullName}`,
    targetTable: "salary_adjustments",
    targetId: result.row.id,
  });
  return Response.json(result.row, { status: 201 });
}

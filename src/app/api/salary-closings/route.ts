import { z } from "zod";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { closeSalaryMonth, salaryClosingOf } from "@/server/salary";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return badRequest("Tháng không hợp lệ");
  return Response.json(await salaryClosingOf(month));
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const parsed = z.object({ month: z.string().regex(MONTH) }).safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Tháng không hợp lệ");
  const { month } = parsed.data;

  const status = await salaryClosingOf(month);
  if (status.closed)
    return Response.json({ message: `Lương tháng ${month} đã chốt` }, { status: 409 });
  if (!status.closable)
    return badRequest("Chỉ chốt được tháng đã kết thúc và đã có công thức lương");

  const saved = await closeSalaryMonth(guard.actor, month);
  if (saved === null)
    return Response.json({ message: `Lương tháng ${month} đã chốt` }, { status: 409 });

  await logAudit(guard.actor, {
    module: "system",
    action: "close-salary",
    targetLabel: `Chốt lương tháng ${month}: ${saved} người`,
    targetTable: "salary_closings",
    targetId: month,
  });
  return Response.json(await salaryClosingOf(month), { status: 201 });
}

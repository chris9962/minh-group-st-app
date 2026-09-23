import { z } from "zod";
import { businessMonth } from "@/lib/format";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { closeSalaryMonth, salaryClosingOf } from "@/server/salary";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const toBody = (month: string, closing: Awaited<ReturnType<typeof salaryClosingOf>>) => ({
  month,
  closed: closing !== null,
  closedAt: closing?.closedAt.toISOString() ?? null,
  closedByName: closing?.closedByName ?? null,
});

export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return badRequest("Tháng không hợp lệ");
  return Response.json(toBody(month, await salaryClosingOf(month)));
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const parsed = z.object({ month: z.string().regex(MONTH) }).safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Tháng không hợp lệ");
  const { month } = parsed.data;
  // Tháng chưa hết thì điểm và ngày công còn tăng; chốt lúc đó là lưu số dở dang.
  if (month >= businessMonth()) return badRequest("Chỉ chốt được tháng đã kết thúc");

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
  return Response.json(toBody(month, await salaryClosingOf(month)), { status: 201 });
}

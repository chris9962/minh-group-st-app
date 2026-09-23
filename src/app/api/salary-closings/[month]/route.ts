import { logAudit } from "@/server/audit";
import { actorWith } from "@/server/auth";
import { reopenSalaryMonth, salaryClosingOf } from "@/server/salary";

type Params = { params: Promise<{ month: string }> };

/** Mở chốt lương: tháng đó quay về tính từ dữ liệu mới nhất. */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const { month } = await params;
  if (!(await reopenSalaryMonth(month)))
    return Response.json({ message: `Lương tháng ${month} chưa chốt` }, { status: 409 });

  await logAudit(guard.actor, {
    module: "system",
    action: "close-salary",
    targetLabel: `Mở chốt lương tháng ${month}`,
    targetTable: "salary_closings",
    targetId: month,
  });
  return Response.json(await salaryClosingOf(month));
}

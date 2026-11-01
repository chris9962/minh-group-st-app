import { AdvanceBatchForm } from "@/lib/api/salaryAdvances";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { approveAllAdvances, markAdvancesPaid, markAdvancesProcessing } from "@/server/salaryAdvances";

const LABEL = {
  "approve-all": "Duyệt tất cả",
  processing: "Chuyển sang Đang xử lý",
  paid: "Đã chi tạm ứng",
} as const;

/** Ba nút của kế toán: Duyệt tất cả, chuyển sang Đang xử lý sau khi xuất Excel, Đã chi tạm ứng. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;
  const parsed = AdvanceBatchForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const form = parsed.data;
  const result =
    form.action === "approve-all"
      ? await approveAllAdvances(guard.actor, form.month)
      : form.action === "processing"
        ? await markAdvancesProcessing(guard.actor, form.month, form.items)
        : await markAdvancesPaid(guard.actor, form.month);
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  if (result.count > 0)
    await logAudit(guard.actor, {
      module: "system",
      action: "close-salary",
      targetLabel: `${LABEL[form.action]} ${result.count} yêu cầu tạm ứng lương tháng ${form.month}`,
      targetTable: "salary_advance_requests",
    });
  return Response.json({ count: result.count });
}

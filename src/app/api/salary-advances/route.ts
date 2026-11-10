import { canOpenSalaryAdvances } from "@/lib/permissions";
import { actorPassing } from "@/server/auth";
import { listAdvances } from "@/server/salaryAdvances";

/** Trang Tạm ứng lương: Trưởng phòng thấy phòng mình, kế toán thấy cả công ty từ 13:00 ngày 10. */
export async function GET(request: Request) {
  const guard = await actorPassing(request, canOpenSalaryAdvances);
  if (!guard.ok) return guard.response;
  const result = await listAdvances(guard.actor, new URL(request.url));
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json(result.data);
}

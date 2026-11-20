import { canOpenMealAllowances } from "@/lib/permissions";
import { actorPassing } from "@/server/auth";
import { listMeals } from "@/server/mealAllowances";

/** Trang Lương ăn ca: Trưởng phòng thấy phòng mình, kế toán thấy cả công ty từ ngày 1 tháng sau. */
export async function GET(request: Request) {
  const guard = await actorPassing(request, canOpenMealAllowances);
  if (!guard.ok) return guard.response;
  const result = await listMeals(guard.actor, new URL(request.url));
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json(result.data);
}

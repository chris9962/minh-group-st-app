import { MealActionForm, MealDaysForm } from "@/lib/api/mealAllowances";
import { formatPoints } from "@/lib/format";
import { logAudit } from "@/server/audit";
import { badRequest, isUuid, jsonBody, notFound, signedIn } from "@/server/auth";
import { actOnMeal, mealDetail, updateMealDays } from "@/server/mealAllowances";

type Params = { params: Promise<{ id: string }> };

const auditAction = (as: "head" | "accounting") =>
  as === "head" ? ({ module: "salary", action: "approve-meal" } as const) : ({ module: "salary", action: "pay-meal" } as const);

/** Dòng ăn ca và lịch sử. Trưởng phòng của phòng đó và kế toán đọc được. */
export async function GET(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const detail = await mealDetail(guard.actor, id);
  return detail ? Response.json(detail) : notFound();
}

/** Trưởng phòng hoặc kế toán sửa số ngày. Máy chủ quyết định ai được sửa theo trạng thái và mốc giờ. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = MealDaysForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const result = await updateMealDays(guard.actor, id, parsed.data.days);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  await logAudit(guard.actor, {
    ...auditAction(result.as),
    targetLabel: `Sửa ăn ca tháng ${result.month} của ${result.fullName} thành ${formatPoints(parsed.data.days)} ngày`,
    targetTable: "meal_allowance_rows",
    targetId: id,
  });
  return Response.json({ ok: true });
}

/** Duyệt, hoặc kế toán bấm Không chi. */
export async function POST(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = MealActionForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const result = await actOnMeal(guard.actor, id, parsed.data);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  const verb = parsed.data.action === "approve" ? "Duyệt" : "Không chi riêng";
  await logAudit(guard.actor, {
    ...auditAction(result.as),
    targetLabel: `${verb} ăn ca tháng ${result.month} của ${result.fullName}`,
    targetTable: "meal_allowance_rows",
    targetId: id,
  });
  return Response.json({ ok: true });
}

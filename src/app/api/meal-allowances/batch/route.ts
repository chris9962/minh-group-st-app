import { MealBatchForm } from "@/lib/api/mealAllowances";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, jsonBody, signedIn } from "@/server/auth";
import {
  approveAllMeals,
  headApproveAllMeals,
  markMealsPaid,
  markMealsProcessing,
} from "@/server/mealAllowances";

const LABEL = {
  "head-approve-all": "Duyệt cả phòng",
  "approve-all": "Duyệt tất cả",
  processing: "Chuyển sang Đang xử lý",
  paid: "Đã chi ăn ca",
} as const;

/** Duyệt cả phòng của Trưởng phòng, và ba nút ghi của kế toán. */
export async function POST(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const parsed = MealBatchForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const form = parsed.data;
  const action = form.action === "head-approve-all" ? "approve-meal" : "pay-meal";
  if (!can(guard.actor, "salary", action)) return forbidden();
  const result =
    form.action === "head-approve-all"
      ? await headApproveAllMeals(guard.actor, form.month)
      : form.action === "approve-all"
        ? await approveAllMeals(guard.actor, form.month)
        : form.action === "processing"
          ? await markMealsProcessing(guard.actor, form.month)
          : await markMealsPaid(guard.actor, form.month);
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  if (result.count > 0)
    await logAudit(guard.actor, {
      module: "salary",
      action,
      targetLabel: `${LABEL[form.action]} ${result.count} dòng ăn ca tháng ${form.month}`,
      targetTable: "meal_allowance_rows",
    });
  return Response.json({ count: result.count });
}

import { StatusTag, type StatusTone } from "@/components/ui/StatusTag";
import { MEAL_STATUS_LABEL, type MealStatus } from "@/lib/api/mealAllowances";

const TONE: Record<MealStatus, StatusTone> = {
  pending: "waiting",
  "head-approved": "review",
  forwarded: "warn",
  approved: "review",
  rejected: "cancelled",
  processing: "progress",
  paid: "ok",
};

export function MealStatusTag({ status }: { status: MealStatus }) {
  return <StatusTag tone={TONE[status]}>{MEAL_STATUS_LABEL[status]}</StatusTag>;
}

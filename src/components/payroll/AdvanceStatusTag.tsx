import { StatusTag, type StatusTone } from "@/components/ui/StatusTag";
import { ADVANCE_STATUS_LABEL, type AdvanceStatus } from "@/lib/api/salaryAdvances";

const TONE: Record<AdvanceStatus, StatusTone> = {
  pending: "waiting",
  "head-approved": "review",
  "head-rejected": "cancelled",
  expired: "warn",
  approved: "review",
  rejected: "cancelled",
  processing: "progress",
  paid: "ok",
};

export function AdvanceStatusTag({ status }: { status: AdvanceStatus }) {
  return <StatusTag tone={TONE[status]}>{ADVANCE_STATUS_LABEL[status]}</StatusTag>;
}

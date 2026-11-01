"use client";

import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonText } from "@/components/ui/Skeleton";
import { ADVANCE_EVENT_LABEL, fetchAdvance, type AdvanceEvent } from "@/lib/api/salaryAdvances";
import { formatDateTime, formatVnd } from "@/lib/format";
import { AdvanceStatusTag } from "./AdvanceStatusTag";
import styles from "./SalaryAdjustments.module.scss";

const amountOf = (e: AdvanceEvent): string =>
  e.fromAmount !== null && e.toAmount !== null
    ? `${formatVnd(e.fromAmount)} → ${formatVnd(e.toAmount)}`
    : e.toAmount !== null
      ? formatVnd(e.toAmount)
      : "—";

/** Lịch sử của một yêu cầu tạm ứng: mỗi lần đổi số tiền hoặc trạng thái một dòng. */
export function AdvanceHistoryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["salary-advance", id], queryFn: () => fetchAdvance(id) });
  const detail = query.data;

  return createPortal(
    <Dialog
      open
      wide
      onClose={onClose}
      title={detail ? `Tạm ứng lương - ${detail.fullName}` : "Tạm ứng lương"}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      {query.isPending ? (
        <SkeletonText lines={4} label="Đang tải" />
      ) : query.isError || !detail ? (
        <ErrorState what="lịch sử tạm ứng" onRetry={query.refetch} retrying={query.isFetching} />
      ) : (
        <div className={styles.form}>
          <p className={styles.summary}>
            <span className="tabular-nums">{formatVnd(detail.amount)}</span>
            <AdvanceStatusTag status={detail.status} />
          </p>
          {detail.rejectReason && <p className={styles.empty}>Lý do từ chối: {detail.rejectReason}</p>}
          <ol className={styles.events} aria-label={`Lịch sử tạm ứng lương của ${detail.fullName}`}>
            {detail.events.map((e) => (
              <li key={e.id} className={styles.event}>
                <div className={styles.eventHead}>
                  <span className={styles.eventKind}>{ADVANCE_EVENT_LABEL[e.kind]}</span>
                  <span className={`${styles.amount} tabular-nums`}>{amountOf(e)}</span>
                </div>
                <span className={styles.eventMeta}>
                  {e.actorName ? `${e.actorName}${e.actorRole ? `, ${e.actorRole}` : ""}` : "App"} -{" "}
                  <span className="tabular-nums">{formatDateTime(e.at)}</span>
                </span>
                {e.note && <span className={styles.eventMeta}>{e.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Dialog>,
    document.body,
  );
}

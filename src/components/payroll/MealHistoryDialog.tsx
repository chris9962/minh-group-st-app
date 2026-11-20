"use client";

import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonText } from "@/components/ui/Skeleton";
import { MEAL_EVENT_LABEL, fetchMeal, mealMonthLabel, type MealEvent } from "@/lib/api/mealAllowances";
import { formatDateTime, formatPoints, formatVnd } from "@/lib/format";
import { MealStatusTag } from "./MealStatusTag";
import styles from "./SalaryAdjustments.module.scss";

const daysOf = (e: MealEvent): string =>
  e.fromDays !== null && e.toDays !== null
    ? `${formatPoints(e.fromDays)} → ${formatPoints(e.toDays)} ngày`
    : e.toDays !== null
      ? `${formatPoints(e.toDays)} ngày`
      : "";

/** Lịch sử của một dòng ăn ca: mỗi lần đổi số ngày hoặc trạng thái một dòng. */
export function MealHistoryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["meal-allowance", id], queryFn: () => fetchMeal(id) });
  const detail = query.data;

  return createPortal(
    <Dialog
      open
      wide
      onClose={onClose}
      title={detail ? `Ăn ca ${mealMonthLabel(detail.month)} - ${detail.fullName}` : "Lương ăn ca"}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      {query.isPending ? (
        <SkeletonText lines={4} label="Đang tải" />
      ) : query.isError || !detail ? (
        <ErrorState what="lịch sử ăn ca" onRetry={query.refetch} retrying={query.isFetching} />
      ) : (
        <div className={styles.form}>
          <p className={styles.summary}>
            <span className="tabular-nums">
              {formatPoints(detail.days)} ngày - {formatVnd(detail.amount)}
            </span>
            <MealStatusTag status={detail.status} />
          </p>
          {detail.rejectReason && <p className={styles.empty}>Lý do không chi riêng: {detail.rejectReason}</p>}
          <ol className={styles.events} aria-label={`Lịch sử ăn ca của ${detail.fullName}`}>
            {detail.events.map((e) => (
              <li key={e.id} className={styles.event}>
                <div className={styles.eventHead}>
                  <span className={styles.eventKind}>{MEAL_EVENT_LABEL[e.kind]}</span>
                  <span className={`${styles.amount} tabular-nums`}>{daysOf(e)}</span>
                </div>
                <span className={styles.eventMeta}>
                  {e.actorName ? `${e.actorName}${e.actorTitle ? `, ${e.actorTitle}` : ""}` : "App"} -{" "}
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

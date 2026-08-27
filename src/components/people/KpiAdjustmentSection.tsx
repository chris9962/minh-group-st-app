"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CirclePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SectionCard } from "@/components/ui/SectionCard";
import { deleteKpiAdjustment, type KpiAdjustment, type PersonDetail } from "@/lib/api/person";
import { formatDate, formatPoints } from "@/lib/format";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import { errorMessage, toast } from "@/lib/toast";
import { KpiAdjustmentFormDialog } from "./KpiAdjustmentFormDialog";
import styles from "./KpiAdjustmentSection.module.scss";

type Props = { person: PersonDetail };

/**
 * P-52 · Các lần cộng điểm KPI tay của tháng hiện tại.
 *
 * Nút ghi chỉ hiện với người có `system:adjust-kpi`; máy chủ kiểm lại ở route.
 * Người không có quyền vẫn THẤY danh sách — điểm cộng nằm trong tổng KPI, giấu
 * đi thì tổng lớn hơn các phần nhìn thấy được.
 */
export function KpiAdjustmentSection({ person }: Props) {
  const queryClient = useQueryClient();
  const actor = useSession((s) => s.user);
  const canAdjust = can(actor, "system", "adjust-kpi");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KpiAdjustment | null>(null);
  const [deleting, setDeleting] = useState<KpiAdjustment | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteKpiAdjustment(person.id, id),
    onSuccess: () => {
      invalidateKpi(queryClient);
      setDeleting(null);
      toast.ok("Đã xoá dòng điểm cộng");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được dòng điểm cộng này.")),
  });

  // Không có quyền ghi và tháng cũng chưa có dòng nào thì cả khối không có gì để nói.
  if (!canAdjust && person.adjustments.length === 0) return null;

  return (
    <>
      <SectionCard
        title="Điểm cộng"
        icon={<CirclePlus size={17} />}
        meta={
          person.adjustments.length > 0
            ? `${formatPoints(person.points.adjustment)} điểm`
            : undefined
        }
        action={
          canAdjust ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} />
              Cộng điểm
            </Button>
          ) : undefined
        }
      >
        {person.adjustments.length === 0 ? (
          <p className={styles.empty}>Tháng này chưa có lần cộng điểm nào.</p>
        ) : (
          <ul className={styles.list}>
            {person.adjustments.map((a) => (
              <li key={a.id} className={styles.row}>
                <div className={styles.info}>
                  <span className={styles.reason}>{a.reason}</span>
                  <span className={styles.meta}>
                    {a.createdByName} · {formatDate(a.date)}
                  </span>
                </div>
                <strong className={`${styles.points} tabular-nums`}>
                  {a.points > 0 ? `+${formatPoints(a.points)}` : formatPoints(a.points)}
                </strong>
                {canAdjust && (
                  <span className={styles.actions}>
                    <Button
                      variant="secondary"
                      icon
                      tooltip="Sửa"
                      aria-label={`Sửa lần cộng ${formatPoints(a.points)} điểm`}
                      onClick={() => setEditing(a)}
                    >
                      <Pencil size={16} aria-hidden />
                    </Button>
                    <Button
                      variant="secondary"
                      icon
                      tooltip="Xoá"
                      aria-label={`Xoá lần cộng ${formatPoints(a.points)} điểm`}
                      onClick={() => setDeleting(a)}
                    >
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {(creating || editing) && (
        <KpiAdjustmentFormDialog
          open
          personId={person.id}
          adjustment={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Xoá dòng điểm cộng"
        confirmLabel="Xoá"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
        consequence={
          <>
            Tổng điểm KPI trong tháng của <strong>{person.fullName}</strong> đổi
            ngay theo. Điểm KPI dính tới lương.
          </>
        }
      >
        Xoá lần cộng <strong>{deleting ? formatPoints(deleting.points) : ""} điểm</strong>
        {deleting?.reason ? <> — {deleting.reason}</> : null}?
      </ConfirmDialog>
    </>
  );
}

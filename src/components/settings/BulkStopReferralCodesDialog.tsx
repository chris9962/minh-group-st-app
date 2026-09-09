"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  fetchBulkStopReferralCodes,
  stopReferralCodesBulk,
  type ReferralCodeQuery,
} from "@/lib/api/bankCatalog";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./BulkStopReferralCodesDialog.module.scss";

type Filters = Pick<ReferralCodeQuery, "bankId" | "departmentId" | "status" | "search">;

type Props = {
  filters: Filters;
  onClose: () => void;
};

/** Chọn và ngừng nhiều mã mà không phải đọc lại bảng nhiều cột phía sau. */
export function BulkStopReferralCodesDialog({ filters, onClose }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { data: codes = [], isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["referral-codes", "bulk-stop", filters],
    queryFn: () => fetchBulkStopReferralCodes(filters),
  });

  const stopCodes = useMutation({
    mutationFn: () => stopReferralCodesBulk([...selected]),
    onSuccess: ({ stopped }) => {
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      toast.ok(`Đã ngừng ${stopped} mã giới thiệu`);
      onClose();
    },
    onError: (error) => toast.fail(errorMessage(error, "Không ngừng được các mã đã chọn.")),
  });

  const allSelected = codes.length > 0 && codes.every((code) => selected.has(code.id));
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const requestClose = () => {
    if (!stopCodes.isPending) onClose();
  };

  return (
    <Dialog
      open
      wide
      title="Ngừng mã hàng loạt"
      onClose={requestClose}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={stopCodes.isPending}>
            Huỷ
          </Button>
          <Button
            variant="danger"
            disabled={selected.size === 0 || stopCodes.isPending}
            onClick={() => stopCodes.mutate()}
          >
            {stopCodes.isPending ? "Đang ngừng…" : `Ngừng ${selected.size} mã`}
          </Button>
        </>
      }
    >
      <p className={styles.intro}>
        Chỉ hiện các mã đang dùng và khớp bộ lọc hiện tại. Bấm vào một dòng để chọn.
      </p>

      {isPending && <p className="text-muted">Đang tải danh sách mã…</p>}
      {isError && (
        <ErrorState what="danh sách mã có thể ngừng" onRetry={refetch} retrying={isFetching} />
      )}

      {!isPending && !isError && codes.length === 0 && (
        <p className="text-muted">Không có mã đang dùng nào khớp bộ lọc.</p>
      )}

      {!isPending && !isError && codes.length > 0 && (
        <>
          <div className={styles.selectAll}>
            <Checkbox
              checked={allSelected}
              disabled={stopCodes.isPending}
              onCheckedChange={(checked) =>
                setSelected(checked ? new Set(codes.map((code) => code.id)) : new Set())
              }
              label={`Chọn tất cả ${codes.length} mã`}
            />
            <span className="text-muted">Đã chọn {selected.size}</span>
          </div>

          <div className={styles.list} role="group" aria-label="Các mã có thể ngừng">
            {codes.map((code) => (
              <div className={styles.option} key={code.id}>
                <Checkbox
                  block
                  checked={selected.has(code.id)}
                  disabled={stopCodes.isPending}
                  onCheckedChange={(checked) => toggle(code.id, checked)}
                  label={
                    <span className={styles.label}>
                      <span className={styles.bank}>{code.bankCode}</span>
                      <span className={styles.name}>{code.displayName}</span>
                    </span>
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

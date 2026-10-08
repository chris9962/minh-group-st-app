"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserLock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { fetchCustomerEditLock, saveCustomerEditLock } from "@/lib/api/ops";
import { formatDateTime } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./CustomerEditLockCard.module.css";

/** P-99 · Thu hồi và cấp lại quyền sửa khách của Nhân viên, trừ Phòng ATM cộng đồng và Phòng An Sinh. */
export function CustomerEditLockCard() {
  const queryClient = useQueryClient();
  const lock = useQuery({ queryKey: ["ops", "customer-edit"], queryFn: fetchCustomerEditLock });
  const [confirming, setConfirming] = useState<"revoke" | "restore" | null>(null);

  const save = useMutation({
    mutationFn: (revoke: boolean) => saveCustomerEditLock({ revoke }),
    onSuccess: (count, revoke) => {
      toast.ok(
        revoke
          ? `Đã thu hồi quyền sửa khách của ${count} nhân viên.`
          : `Đã cấp lại quyền sửa khách cho ${count} nhân viên.`,
      );
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: ["ops", "customer-edit"] });
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được quyền sửa khách.")),
  });

  const meta = lock.data?.revoked
    ? `Đang thu hồi ${lock.data.revoked} nhân viên - ${formatDateTime(lock.data.revokedAt)} - ${lock.data.revokedBy}`
    : undefined;

  return (
    <SectionCard title="Quyền sửa hồ sơ khách" icon={<UserLock size={17} />} meta={meta}>
      {lock.isError ? (
        <ErrorState what="quyền sửa khách" onRetry={lock.refetch} retrying={lock.isFetching} />
      ) : lock.isPending ? (
        <SkeletonTable rows={1} columns={2} />
      ) : (
        <div className={styles.row}>
          <Button variant="danger" onClick={() => setConfirming("revoke")}>
            Thu hồi quyền sửa khách
          </Button>
          <Button
            variant="secondary"
            disabled={lock.data.revoked === 0}
            onClick={() => setConfirming("restore")}
          >
            Cấp lại quyền sửa khách
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === "revoke" ? "Thu hồi quyền sửa khách" : "Cấp lại quyền sửa khách"}
        confirmLabel={confirming === "revoke" ? "Thu hồi" : "Cấp lại"}
        pending={save.isPending}
        onConfirm={() => save.mutate(confirming === "revoke")}
        onClose={() => setConfirming(null)}
      >
        {confirming === "revoke"
          ? "Bạn muốn thu hồi quyền sửa khách của mọi nhân viên, trừ Phòng ATM cộng đồng và Phòng An Sinh?"
          : `Bạn muốn cấp lại quyền sửa khách cho ${lock.data?.revoked ?? 0} nhân viên?`}
      </ConfirmDialog>
    </SectionCard>
  );
}

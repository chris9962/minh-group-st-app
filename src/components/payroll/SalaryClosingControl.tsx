"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { monthLabel } from "@/components/ui/MonthPicker";
import { StatusTag } from "@/components/ui/StatusTag";
import { Tooltip } from "@/components/ui/Tooltip";
import { closeSalary, fetchSalaryClosing } from "@/lib/api/salaryClosings";
import { errorMessage, toast } from "@/lib/toast";

/** Nút Chốt lương của một tháng. Nơi dùng tự kiểm quyền `system:close-salary`. */
export function SalaryClosingControl({ month }: { month: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data } = useQuery({
    queryKey: ["salary-closing", month],
    queryFn: () => fetchSalaryClosing(month),
  });

  const close = useMutation({
    mutationFn: () => closeSalary(month),
    onSuccess: () => {
      setConfirming(false);
      toast.ok(`Đã chốt lương ${monthLabel(month)}`);
      // Lương hiện ở nhiều màn (Tổng quan, Nhân sự, hồ sơ, phòng ban): tải lại hết.
      void queryClient.invalidateQueries();
    },
    onError: (e) => {
      setConfirming(false);
      toast.fail(errorMessage(e, "Không chốt được lương."));
      // Lỗi hay gặp nhất là người khác vừa chốt: tải lại để nút đổi theo.
      void queryClient.invalidateQueries({ queryKey: ["salary-closing", month] });
    },
  });

  if (!data) return null;
  if (data.closed) return <StatusTag ok>Đã chốt lương</StatusTag>;

  return (
    <>
      <Tooltip content={data.blockedReason}>
        <Button variant="secondary" disabled={!data.closable} onClick={() => setConfirming(true)}>
          <Lock size={16} aria-hidden />
          Chốt lương
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={confirming}
        title="Chốt lương"
        confirmLabel="Chốt lương"
        pending={close.isPending}
        onConfirm={() => close.mutate()}
        onClose={() => setConfirming(false)}
        consequence="Sau khi chốt, lương tháng này không đổi nữa và không mở chốt được."
      >
        Chốt lương <strong>{monthLabel(month)}</strong>?
      </ConfirmDialog>
    </>
  );
}

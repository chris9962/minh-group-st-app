"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { StatusTag } from "@/components/ui/StatusTag";
import { closeSalary, fetchSalaryClosing, reopenSalary } from "@/lib/api/salaryClosings";
import { errorMessage, toast } from "@/lib/toast";

/** Nút Chốt lương / Mở chốt lương của một tháng. Nơi dùng tự kiểm quyền `system:close-salary`. */
export function SalaryClosingControl({ month }: { month: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data } = useQuery({
    queryKey: ["salary-closing", month],
    queryFn: () => fetchSalaryClosing(month),
  });

  const toggle = useMutation({
    mutationFn: () => (data?.closed ? reopenSalary(month) : closeSalary(month)),
    onSuccess: (next) => {
      setConfirming(false);
      toast.ok(next.closed ? `Đã chốt lương ${monthLabel(month)}` : `Đã mở chốt lương ${monthLabel(month)}`);
      // Lương hiện ở nhiều màn (Tổng quan, Nhân sự, hồ sơ, phòng ban): tải lại hết.
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được trạng thái chốt lương.")),
  });

  if (!data) return null;
  // Tháng chưa kết thúc thì điểm và ngày công còn tăng; máy chủ cũng từ chối.
  const monthRunning = month >= thisMonth();

  return (
    <>
      {data.closed && <StatusTag ok>Đã chốt lương</StatusTag>}
      <Button
        variant="secondary"
        disabled={!data.closed && monthRunning}
        onClick={() => setConfirming(true)}
      >
        {data.closed ? <Unlock size={16} aria-hidden /> : <Lock size={16} aria-hidden />}
        {data.closed ? "Mở chốt lương" : "Chốt lương"}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={data.closed ? "Mở chốt lương" : "Chốt lương"}
        confirmLabel={data.closed ? "Mở chốt" : "Chốt lương"}
        pending={toggle.isPending}
        onConfirm={() => toggle.mutate()}
        onClose={() => setConfirming(false)}
        consequence={
          data.closed
            ? "Lương tháng này sẽ tính lại theo dữ liệu mới nhất."
            : "Sau khi chốt, lương tháng này không đổi theo dữ liệu nữa."
        }
      >
        {data.closed ? "Mở chốt" : "Chốt"} lương <strong>{monthLabel(month)}</strong>?
      </ConfirmDialog>
    </>
  );
}

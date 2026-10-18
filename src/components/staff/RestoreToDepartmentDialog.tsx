"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { monthLabel } from "@/components/ui/MonthPicker";
import { includeInDepartmentPoints } from "@/lib/api/departmentPoints";
import { errorMessage, toast } from "@/lib/toast";
import { invalidateDepartmentPoints } from "./ExcludeFromDepartmentDialog";

type Props = {
  /** Người đang bị loại; `null` = hộp thoại đóng. */
  staff: { id: string; fullName: string } | null;
  month: string;
  onClose: () => void;
};

/** Khôi phục một nhân viên vào điểm phòng của tháng, dùng ở P-54 và trang chi tiết phòng. */
export function RestoreToDepartmentDialog({ staff, month, onClose }: Props) {
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: (id: string) => includeInDepartmentPoints(id, month),
    onSuccess: () => {
      invalidateDepartmentPoints(queryClient);
      toast.ok(`Đã khôi phục ${staff?.fullName ?? "nhân viên"} vào điểm phòng`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không khôi phục được nhân viên này. Thử lại.")),
  });

  return (
    <ConfirmDialog
      open={staff !== null}
      title="Khôi phục điểm phòng"
      confirmLabel="Khôi phục"
      pending={restore.isPending}
      onConfirm={() => staff && restore.mutate(staff.id)}
      onClose={onClose}
    >
      Bạn muốn khôi phục <strong>{staff?.fullName}</strong> vào điểm phòng{" "}
      {monthLabel(month).toLowerCase()}?
    </ConfirmDialog>
  );
}

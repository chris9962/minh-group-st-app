"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { transferCustomerOwner } from "@/lib/api/customers";
import { fetchStaffOptions } from "@/lib/api/staff";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";

/** Đổi người tạo hồ sơ khách sang nhân viên khác cùng phòng. Chỉ tài khoản toàn quyền mở được. */
export function CustomerOwnerDialog({
  customerId,
  ownerId,
  departmentId,
  onClose,
}: {
  customerId: string;
  ownerId: string | null;
  departmentId: string;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const queryClient = useQueryClient();

  const { data: staff, isPending, isError } = useQuery({
    queryKey: ["staff", "options", "active", departmentId],
    queryFn: () => fetchStaffOptions({ departmentId, status: "active" }),
  });

  const save = useMutation({
    mutationFn: () => transferCustomerOwner(customerId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      // Máy chủ đổi luôn người tạo của tài khoản, đơn bảo hiểm, dịch vụ và VNeID của khách.
      for (const key of ["bank-account-list", "bank-account-detail", "insurance-list", "insurance-detail", "services", "vneid"])
        queryClient.invalidateQueries({ queryKey: [key] });
      invalidateKpi(queryClient);
      toast.ok("Đã đổi người tạo và tính lại KPI");
      onClose();
    },
    onError: (error) => toast.fail(errorMessage(error, "Không đổi được người tạo")),
  });

  const close = () => {
    if (!save.isPending) onClose();
  };

  const options = [
    {
      value: "",
      label: isError ? "Không tải được danh sách nhân viên" : isPending ? "Đang tải…" : "Chọn nhân viên",
    },
    ...(staff ?? [])
      .filter((s) => s.id !== ownerId)
      .map((s) => ({ value: s.id, label: `${s.fullName} - ${s.username}` })),
  ];

  return (
    <Dialog
      open
      title="Đổi người tạo"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !userId}>
            {save.isPending ? "Đang đổi…" : "Đổi người tạo"}
          </Button>
        </>
      }
    >
      <Select
        block
        label="Nhân viên nhận"
        required
        value={userId}
        options={options}
        onChange={setUserId}
        disabled={save.isPending || isPending}
      />
    </Dialog>
  );
}

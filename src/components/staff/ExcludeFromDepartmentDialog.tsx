"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { monthLabel } from "@/components/ui/MonthPicker";
import { excludeFromDepartmentPoints } from "@/lib/api/departmentPoints";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./ExcludeFromDepartmentDialog.module.scss";

/** Loại hay khôi phục đều đổi điểm phòng và lương quản lý ở mọi màn hiện hai số đó. */
const DEPARTMENT_POINTS_KEYS = [
  "staff-by-department",
  "org-department",
  "org-department-stats",
  "dashboard",
  "person",
  "staff",
];

export function invalidateDepartmentPoints(queryClient: QueryClient) {
  for (const key of DEPARTMENT_POINTS_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
}

type Props = {
  month: string;
  staff: { id: string; fullName: string };
  onClose: () => void;
};

/**
 * Không tính điểm của một nhân viên vào điểm phòng của tháng, ở trang chi
 * tiết phòng. Nơi gọi chỉ vẽ hộp thoại khi mở, nên mỗi lần mở là một form trống.
 */
export function ExcludeFromDepartmentDialog({ month, staff, onClose }: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () => excludeFromDepartmentPoints(staff.id, { month, note }),
    onSuccess: () => {
      invalidateDepartmentPoints(queryClient);
      toast.ok(`Đã đánh dấu ${staff.fullName} không tính điểm phòng`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được. Thử lại.")),
  });

  // Đang lưu thì không đóng được: đóng rồi mà lượt ghi vẫn chạy là người dùng tưởng đã huỷ.
  const close = () => {
    if (!save.isPending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={`Không tính điểm phòng ${monthLabel(month).toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="exclude-department-form" disabled={save.isPending}>
            Không tính
          </Button>
        </>
      }
    >
      <form
        id="exclude-department-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        <p className={styles.question}>
          Bạn muốn không tính điểm của <strong>{staff.fullName}</strong> vào điểm phòng{" "}
          {monthLabel(month).toLowerCase()}?
        </p>
        <TextArea
          label="Lý do"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </Dialog>
  );
}

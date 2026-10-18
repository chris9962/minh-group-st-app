"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { monthLabel } from "@/components/ui/MonthPicker";
import {
  excludeFromDepartmentPoints,
  fetchDepartmentPointsOptions,
} from "@/lib/api/departmentPoints";
import { formatPoints } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./ExcludeFromDepartmentDialog.module.scss";

type Props = {
  month: string;
  onClose: () => void;
};

/**
 * P-54 · Thêm một nhân viên vào danh sách loại khỏi điểm phòng của tháng.
 * Nơi gọi chỉ vẽ hộp thoại khi mở, nên mỗi lần mở là một form trống.
 */
export function ExcludeFromDepartmentDialog({ month, onClose }: Props) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);

  const { data: options = [] } = useQuery({
    queryKey: ["department-points-options", month],
    queryFn: () => fetchDepartmentPointsOptions(month),
  });
  const picked = options.find((o) => o.id === userId);

  const save = useMutation({
    mutationFn: () => excludeFromDepartmentPoints(userId, { month, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["department-points"] });
      queryClient.invalidateQueries({ queryKey: ["department-points-options"] });
      toast.ok(`Đã loại ${picked?.fullName ?? "nhân viên"} khỏi điểm phòng`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không loại được nhân viên này. Thử lại.")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      setMissing(true);
      return;
    }
    save.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Loại khỏi điểm phòng ${monthLabel(month).toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="exclude-department-form" disabled={save.isPending}>
            Loại
          </Button>
        </>
      }
    >
      <form id="exclude-department-form" className={styles.form} onSubmit={submit} noValidate>
        <Combobox
          label="Nhân viên"
          block
          required
          placeholder="Gõ tên hoặc mã nhân viên"
          value={userId}
          onChange={(value) => {
            setUserId(value);
            setMissing(false);
          }}
          error={missing ? "Chọn nhân viên cần loại" : undefined}
          options={options.map((o) => ({
            value: o.id,
            label: [o.fullName, o.staffCode, o.departmentName, `${formatPoints(o.points)} điểm`]
              .filter(Boolean)
              .join(" - "),
          }))}
        />
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

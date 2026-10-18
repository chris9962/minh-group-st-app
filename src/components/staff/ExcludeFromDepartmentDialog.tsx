"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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

/** Loại hay khôi phục đều đổi điểm phòng và lương quản lý ở mọi màn hiện hai số đó. */
const DEPARTMENT_POINTS_KEYS = [
  "department-points",
  "department-points-options",
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
  /** Có thì loại đúng người này; không có thì form cho chọn người (P-54). */
  staff?: { id: string; fullName: string };
  onClose: () => void;
};

/**
 * Thêm một nhân viên vào danh sách loại khỏi điểm phòng của tháng.
 * Nơi gọi chỉ vẽ hộp thoại khi mở, nên mỗi lần mở là một form trống.
 */
export function ExcludeFromDepartmentDialog({ month, staff, onClose }: Props) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState(staff?.id ?? "");
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);

  const {
    data: options = [],
    isPending: optionsPending,
    isError: optionsError,
  } = useQuery({
    queryKey: ["department-points-options", month],
    queryFn: () => fetchDepartmentPointsOptions(month),
    enabled: !staff,
  });
  const fullName = staff?.fullName ?? options.find((o) => o.id === userId)?.fullName ?? "nhân viên";

  const save = useMutation({
    mutationFn: () => excludeFromDepartmentPoints(userId, { month, note }),
    onSuccess: () => {
      invalidateDepartmentPoints(queryClient);
      toast.ok(`Đã loại ${fullName} khỏi điểm phòng`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không loại được nhân viên này. Thử lại.")),
  });

  // Đang lưu thì không đóng được: đóng rồi mà lượt loại vẫn chạy là người dùng tưởng đã huỷ.
  const close = () => {
    if (!save.isPending) onClose();
  };

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
      onClose={close}
      title={`Loại khỏi điểm phòng ${monthLabel(month).toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="exclude-department-form" disabled={save.isPending}>
            Loại
          </Button>
        </>
      }
    >
      <form id="exclude-department-form" className={styles.form} onSubmit={submit} noValidate>
        {staff ? (
          <p className={styles.question}>
            Bạn muốn loại <strong>{staff.fullName}</strong> khỏi điểm phòng{" "}
            {monthLabel(month).toLowerCase()}?
          </p>
        ) : (
          <Combobox
            label="Nhân viên"
            block
            required
            placeholder={optionsPending ? "Đang tải danh sách nhân viên…" : "Gõ tên hoặc mã nhân viên"}
            value={userId}
            onChange={(value) => {
              setUserId(value);
              setMissing(false);
            }}
            error={
              optionsError
                ? "Không tải được danh sách nhân viên. Đóng form rồi mở lại."
                : missing
                  ? "Chọn nhân viên cần loại"
                  : undefined
            }
            options={options.map((o) => ({
              value: o.id,
              label: [o.fullName, o.staffCode, o.departmentName, `${formatPoints(o.points)} điểm`]
                .filter(Boolean)
                .join(" - "),
            }))}
          />
        )}
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

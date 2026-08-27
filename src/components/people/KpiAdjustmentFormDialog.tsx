"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import {
  createKpiAdjustment,
  KpiAdjustmentForm,
  updateKpiAdjustment,
  type KpiAdjustment,
} from "@/lib/api/person";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";
import styles from "./KpiAdjustmentFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  personId: string;
  /** Có thì là sửa, không có thì là cộng lần mới. */
  adjustment?: KpiAdjustment | null;
};

/** P-52 · Cộng / sửa một lần điểm cộng KPI — luôn vào tháng hiện tại. */
export function KpiAdjustmentFormDialog({ open, onClose, personId, adjustment }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(adjustment);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KpiAdjustmentForm>({
    shouldFocusError: false,
    resolver: zodResolver(KpiAdjustmentForm),
    defaultValues: {
      points: adjustment?.points,
      reason: adjustment?.reason ?? "",
    },
  });

  /**
   * Ô điểm là `type="text"` + `inputMode="decimal"`, KHÔNG phải `type="number"`:
   * Safari không chặn chữ trong ô number, còn `inputMode` mới là thứ quyết định
   * bàn phím số trên mobile. Chặn chữ bằng tay ở `onChange`.
   */
  const sanitizePoints = (v: string) => {
    const cleaned = v.replace(/[^0-9.,-]/g, "");
    // Dấu trừ chỉ có nghĩa ở đầu.
    return (cleaned.startsWith("-") ? "-" : "") + cleaned.replace(/-/g, "");
  };

  const pointsField = register("points", {
    // Người Việt gõ dấu phẩy cho phần lẻ; đổi sang dấu chấm trước khi parse.
    // Chuỗi rỗng thành NaN để zod báo "Chưa nhập số điểm".
    setValueAs: (v) => {
      const s = String(v).trim().replace(",", ".");
      return s === "" || s === "-" ? Number.NaN : Number(s);
    },
  });

  const save = useMutation({
    mutationFn: (form: KpiAdjustmentForm) =>
      adjustment
        ? updateKpiAdjustment(personId, adjustment.id, form)
        : createKpiAdjustment(personId, form),
    onSuccess: () => {
      invalidateKpi(queryClient);
      onClose();
      toast.ok(editing ? "Đã sửa điểm cộng" : "Đã cộng điểm");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được điểm cộng này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa điểm cộng" : "Cộng điểm KPI"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="kpi-adjustment-form"
            disabled={isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Cộng điểm"}
          </Button>
        </>
      }
    >
      <form
        id="kpi-adjustment-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Số điểm"
          type="text"
          inputMode="decimal"
          hint="Nhập số âm để trừ điểm"
          error={errors.points?.message}
          {...pointsField}
          onChange={(e) => {
            e.target.value = sanitizePoints(e.target.value);
            void pointsField.onChange(e);
          }}
        />
        <TextField
          label="Lý do"
          placeholder="Hỗ trợ sự kiện khai trương"
          error={errors.reason?.message}
          {...register("reason")}
        />
      </form>
    </Dialog>
  );
}

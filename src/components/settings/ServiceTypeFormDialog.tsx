"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import {
  createServiceType,
  ServiceTypeForm,
  updateServiceType,
  type ServiceTypeRow,
} from "@/lib/api/settings";
import styles from "./ServiceTypeFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import {
  decimalOnly,
  digitsOnly,
  numberValue,
  numericField,
  optionalNumberValue,
} from "@/lib/numberField";
import { reportInvalid } from "@/lib/formErrors";
import { formatPoints } from "@/lib/format";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm loại mới. */
  serviceType?: ServiceTypeRow | null;
};

/** P-84 · Lập / sửa một loại dịch vụ. */
export function ServiceTypeFormDialog({ open, onClose, serviceType }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(serviceType);
  const [confirming, setConfirming] = useState<ServiceTypeForm | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServiceTypeForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(ServiceTypeForm),
    defaultValues: {
      name: serviceType?.name ?? "",
      coefficient: serviceType?.coefficient ?? 1,
      dailyCap: serviceType?.dailyCap ?? null,
      monthlyCap: serviceType?.monthlyCap ?? null,
    },
  });

  const save = useMutation({
    mutationFn: (form: ServiceTypeForm) =>
      serviceType ? updateServiceType(serviceType.id, form) : createServiceType(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-types"] });
      // Hệ số vào thẳng công thức điểm KPI, mà P-51/P-52 đọc điểm qua các khoá
      // này — không nạp lại thì hai màn đó hiện điểm theo hệ số cũ.
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setConfirming(null);
      onClose();
      toast.ok("Đã lưu loại dịch vụ");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được loại dịch vụ này.")),
  });

  /**
   * Đổi hệ số là tính lại điểm KPI của mọi nhân viên, mà điểm KPI dính tới
   * lương. Gõ nhầm 10 thay vì 1 thì không có gì kéo lại được, nên hỏi lại —
   * chỉ khi hệ số thật sự đổi, không phải mọi lần bấm Lưu.
   */
  const submit = (form: ServiceTypeForm) => {
    if (serviceType && form.coefficient !== serviceType.coefficient) setConfirming(form);
    else save.mutate(form);
  };

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa loại dịch vụ" : "Thêm loại dịch vụ"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="service-type-form"
            disabled={isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Tạo loại dịch vụ"}
          </Button>
        </>
      }
    >
      <form
        id="service-type-form"
        className={styles.form}
        onSubmit={handleSubmit(submit, reportInvalid)}
        noValidate
      >
        <TextField
          label="Tên loại dịch vụ"
          placeholder="Xác nhận cư trú"
          error={errors.name?.message}
          {...register("name")}
        />
        <TextField
          label="Hệ số điểm KPI"
          type="text"
          inputMode="decimal"
          hint="Mặc định 1"
          error={errors.coefficient?.message}
          {...numericField(register("coefficient", { setValueAs: numberValue }), decimalOnly)}
        />
        <TextField
          label="Trần lượt mỗi ngày"
          type="text"
          inputMode="numeric"
          placeholder="Không giới hạn"
          error={errors.dailyCap?.message}
          {...numericField(register("dailyCap", { setValueAs: optionalNumberValue }), digitsOnly)}
        />
        <TextField
          label="Trần lượt mỗi tháng"
          type="text"
          inputMode="numeric"
          placeholder="Không giới hạn"
          error={errors.monthlyCap?.message}
          {...numericField(register("monthlyCap", { setValueAs: optionalNumberValue }), digitsOnly)}
        />
      </form>
    </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        title="Đổi hệ số điểm KPI"
        confirmLabel="Đổi hệ số"
        pending={save.isPending}
        onConfirm={() => confirming && save.mutate(confirming)}
        onClose={() => setConfirming(null)}
      >
        Bạn muốn đổi hệ số của <strong>{serviceType?.name}</strong> từ{" "}
        <strong>{serviceType && formatPoints(serviceType.coefficient)}</strong> thành{" "}
        <strong>{confirming && formatPoints(confirming.coefficient)}</strong>? Điểm KPI của các tháng
        trước cũng tính lại.
      </ConfirmDialog>
    </>
  );
}

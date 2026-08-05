"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServiceTypeForm>({
    resolver: zodResolver(ServiceTypeForm),
    defaultValues: {
      name: serviceType?.name ?? "",
      coefficient: serviceType?.coefficient ?? 1,
    },
  });

  const save = useMutation({
    mutationFn: (form: ServiceTypeForm) =>
      serviceType ? updateServiceType(serviceType.id, form) : createServiceType(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-types"] });
      onClose();
      toast.ok("Đã lưu loại dịch vụ");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được loại dịch vụ này.")),
  });

  return (
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
        onSubmit={handleSubmit((form) => save.mutate(form))}
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
          type="number"
          inputMode="numeric"
          hint="Mặc định 1"
          error={errors.coefficient?.message}
          {...register("coefficient", { valueAsNumber: true })}
        />
      </form>
    </Dialog>
  );
}

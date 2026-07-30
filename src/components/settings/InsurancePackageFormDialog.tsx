"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import {
  createInsurancePackage,
  InsurancePackageForm,
  updateInsurancePackage,
  type InsurancePackage,
} from "@/lib/api/settings";
import styles from "./InsurancePackageFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm gói mới. */
  insurancePackage?: InsurancePackage | null;
};

/** P-82 · Lập / sửa một gói bảo hiểm. */
export function InsurancePackageFormDialog({ open, onClose, insurancePackage }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(insurancePackage);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InsurancePackageForm>({
    resolver: zodResolver(InsurancePackageForm),
    defaultValues: {
      name: insurancePackage?.name ?? "",
      yearlyFee: insurancePackage?.yearlyFee ?? 0,
    },
  });

  const save = useMutation({
    mutationFn: (form: InsurancePackageForm) =>
      insurancePackage
        ? updateInsurancePackage(insurancePackage.id, form)
        : createInsurancePackage(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-packages"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa gói bảo hiểm" : "Thêm gói bảo hiểm"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="insurance-package-form"
            disabled={isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Tạo gói"}
          </Button>
        </>
      }
    >
      <form
        id="insurance-package-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không lưu được gói bảo hiểm này.</Alert>}

        <TextField
          label="Tên gói"
          placeholder="1 năm BH tai nạn điện gói 100k"
          error={errors.name?.message}
          {...register("name")}
        />
        <TextField
          label="Phí / năm (đồng)"
          type="number"
          inputMode="numeric"
          error={errors.yearlyFee?.message}
          {...register("yearlyFee", { valueAsNumber: true })}
        />
      </form>
    </Dialog>
  );
}

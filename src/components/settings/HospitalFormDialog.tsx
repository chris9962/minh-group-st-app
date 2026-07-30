"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { createHospital, HospitalForm } from "@/lib/api/hospitalCatalog";
import styles from "./HospitalFormDialog.module.scss";

type Props = { open: boolean; onClose: () => void };

/** P-2.5 · Thêm một bệnh viện mới vào danh mục. */
export function HospitalFormDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<HospitalForm>({
    resolver: zodResolver(HospitalForm),
    defaultValues: { name: "" },
  });

  const save = useMutation({
    mutationFn: createHospital,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospitals"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm bệnh viện"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="hospital-form" disabled={isSubmitting || save.isPending}>
            Tạo bệnh viện
          </Button>
        </>
      }
    >
      <form
        id="hospital-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không lưu được bệnh viện này.</Alert>}
        <TextField
          label="Tên bệnh viện"
          placeholder="Bệnh viện Đa khoa Tân Bình"
          error={errors.name?.message}
          {...register("name")}
        />
      </form>
    </Dialog>
  );
}

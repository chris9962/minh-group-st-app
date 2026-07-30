"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { createWard, WardForm } from "@/lib/api/wardCatalog";
import styles from "./WardFormDialog.module.scss";

type Props = { open: boolean; onClose: () => void };

/** P-71 · Thêm một xã mới vào danh mục. */
export function WardFormDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<WardForm>({
    resolver: zodResolver(WardForm),
    defaultValues: { name: "" },
  });

  const save = useMutation({
    mutationFn: createWard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wards"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm xã"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="ward-form" disabled={isSubmitting || save.isPending}>
            Tạo xã
          </Button>
        </>
      }
    >
      <form
        id="ward-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không lưu được xã này.</Alert>}
        <TextField
          label="Tên xã"
          placeholder="Xã Tân Bình"
          error={errors.name?.message}
          {...register("name")}
        />
      </form>
    </Dialog>
  );
}

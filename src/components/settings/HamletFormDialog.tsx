"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { createHamlet, HamletForm, type Ward } from "@/lib/api/wardCatalog";
import styles from "./WardFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

type Props = { open: boolean; onClose: () => void; ward: Ward };

/** P-71 · Thêm một ấp vào xã đã chọn sẵn. */
export function HamletFormDialog({ open, onClose, ward }: Props) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<HamletForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(HamletForm),
    defaultValues: { wardId: ward.id, name: "" },
  });

  const save = useMutation({
    mutationFn: createHamlet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provinces"] });
      onClose();
      toast.ok("Đã lưu ấp");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ấp này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Thêm ấp · ${ward.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="hamlet-form" disabled={isSubmitting || save.isPending}>
            Tạo ấp
          </Button>
        </>
      }
    >
      <form
        id="hamlet-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <input type="hidden" {...register("wardId")} />
        <TextField
          label="Tên ấp"
          placeholder="Ấp 4"
          error={errors.name?.message}
          {...register("name")}
        />
      </form>
    </Dialog>
  );
}

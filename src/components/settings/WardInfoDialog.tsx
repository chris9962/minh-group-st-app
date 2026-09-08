"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { updateWard, WardUpdateForm, type Ward } from "@/lib/api/wardCatalog";
import styles from "./WardFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

type Props = { open: boolean; onClose: () => void; ward: Ward };

/**
 * P-71 · Sửa trưởng xã của một xã/phường đang dùng.
 *
 * Không có ô tên xã: tên chép từ tham chiếu lúc thêm (`WardFormDialog`), người
 * dùng không đổi được. Đổi tên hành chính thật thì sửa bảng tham chiếu.
 */
export function WardInfoDialog({ open, onClose, ward }: Props) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<WardUpdateForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(WardUpdateForm),
    defaultValues: { leaderName: ward.leaderName, leaderPhone: ward.leaderPhone },
  });

  const save = useMutation({
    mutationFn: (form: WardUpdateForm) => updateWard(ward.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provinces"] });
      onClose();
      toast.ok("Đã lưu thông tin xã");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được thông tin xã này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Trưởng xã - ${ward.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="ward-info-form" disabled={isSubmitting || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="ward-info-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Trưởng xã"
          placeholder="Nguyễn Văn A"
          autoComplete="off"
          error={errors.leaderName?.message}
          {...register("leaderName")}
        />
        <TextField
          label="Số điện thoại trưởng xã"
          placeholder="0901 234 567"
          inputMode="tel"
          autoComplete="off"
          error={errors.leaderPhone?.message}
          {...register("leaderPhone")}
        />
      </form>
    </Dialog>
  );
}

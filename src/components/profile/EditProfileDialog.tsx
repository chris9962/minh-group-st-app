"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { ProfileInfoForm, updateProfileInfo } from "@/lib/api/profile";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import styles from "./EditProfileDialog.module.scss";

/** Tự sửa họ tên và số điện thoại, mở từ nhóm Thông tin cá nhân ở màn Cá nhân. */
export function EditProfileDialog({
  info,
  onClose,
}: {
  info: ProfileInfoForm;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileInfoForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(ProfileInfoForm),
    defaultValues: info,
  });

  const save = useMutation({
    mutationFn: updateProfileInfo,
    onSuccess: (saved) => {
      // Họ tên hiện ở nhiều chỗ đọc từ phiên, không đọc lại máy chủ.
      if (user) refresh({ ...user, fullName: saved.fullName });
      queryClient.setQueryData(["profile-info"], saved);
      toast.ok("Đã lưu thông tin cá nhân");
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được thông tin cá nhân.")),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Sửa thông tin"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="profile-info-form" disabled={isSubmitting || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="profile-info-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Họ tên"
          required
          autoComplete="name"
          error={errors.fullName?.message}
          {...register("fullName")}
        />
        <TextField
          label="Số điện thoại"
          required
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={10}
          error={errors.phone?.message}
          {...register("phone")}
        />
      </form>
    </Dialog>
  );
}

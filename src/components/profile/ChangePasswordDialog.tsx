"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PasswordField } from "@/components/ui/PasswordField";
import { changePassword, PASSWORD_ERROR, PasswordForm } from "@/lib/api/profile";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./ChangePasswordDialog.module.scss";
import { reportInvalid } from "@/lib/formErrors";

const emptyForm: PasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

/** C-02 · Tự đổi mật khẩu, mở từ thẻ Tài khoản ở màn Thông tin cá nhân. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(PasswordForm),
    defaultValues: emptyForm,
  });

  const save = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast.ok("Đã đổi mật khẩu. Thiết bị khác phải đăng nhập lại.");
      onClose();
    },
    onError: (e) => {
      // Sai mật khẩu hiện tại là lỗi của MỘT ô, gắn vào đúng ô đó. Đẩy ra toast
      // thì người dùng đọc xong không biết phải sửa ô nào.
      if ((e as { code?: string })?.code === PASSWORD_ERROR.WRONG_CURRENT) {
        setError("currentPassword", { message: "Mật khẩu hiện tại không đúng" });
        return;
      }
      toast.fail(errorMessage(e, "Không đổi được mật khẩu. Kiểm tra kết nối rồi thử lại."));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Đổi mật khẩu"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="password-form" disabled={isSubmitting || save.isPending}>
            Đổi mật khẩu
          </Button>
        </>
      }
    >
      <form
        id="password-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        {/* `off` chứ không phải `current-password`: ô này là bước xác minh người
            đang ngồi trước máy. Để trình duyệt điền sẵn thì bất kỳ ai mở được
            máy cũng bấm đổi mật khẩu xong, đúng thứ ô này định chặn. */}
        <PasswordField
          label="Mật khẩu hiện tại"
          placeholder="Mật khẩu đang dùng"
          autoComplete="off"
          error={errors.currentPassword?.message}
          {...register("currentPassword")}
        />
        <PasswordField
          label="Mật khẩu mới"
          placeholder="Mật khẩu muốn đổi sang"
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register("newPassword")}
        />
        <PasswordField
          label="Nhập lại mật khẩu mới"
          placeholder="Gõ lại mật khẩu mới"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        <p className={styles.note}>
          Đổi xong, các thiết bị khác đang đăng nhập bằng tài khoản này bị đăng
          xuất. Máy bạn đang dùng thì vẫn ở nguyên.
        </p>
      </form>
    </Dialog>
  );
}

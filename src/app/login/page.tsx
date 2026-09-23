"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { BrandPanel } from "@/components/brand/BrandPanel";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Logo } from "@/components/ui/Logo";
import { PasswordField } from "@/components/ui/PasswordField";
import { TextField } from "@/components/ui/TextField";
import {
  ApiError,
  login,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WARN_AFTER,
} from "@/lib/api/auth";
import { LOGIN_ERROR, LoginForm } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

export default function LoginPage() {
  const router = useRouter();
  const saveSession = useSession((s) => s.login);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LoginForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(LoginForm),
    defaultValues: { username: "", password: "", remember: false },
  });

  /**
   * Số lần sai liên tiếp của đúng tên đăng nhập đang gõ, đếm ở trình duyệt.
   *
   * Máy chủ cố ý không trả số lần còn lại (xem `api/login/route.ts`), nên con số
   * này chỉ để nhắc: tab khác hay máy khác thử sai thì nó không biết. Ngưỡng khoá
   * thật vẫn do máy chủ giữ.
   */
  const [misses, setMisses] = useState({ username: "", count: 0 });
  const [warnOpen, setWarnOpen] = useState(false);

  const submit = useMutation({
    mutationFn: login,
    // `fetch` hỏng vì mất mạng ném TypeError chứ không phải ApiError — bắt cả
    // hai ở đây, không thì lỗi đó rơi vào khoảng không và màn hình đứng im.
    onError: (e, vars) => {
      if (e instanceof ApiError && e.detail.code === LOGIN_ERROR.BAD_CREDENTIALS) {
        const username = vars.username.trim().toLowerCase();
        const count = misses.username === username ? misses.count + 1 : 1;
        setMisses({ username, count });
        if (count >= LOGIN_WARN_AFTER) {
          setWarnOpen(true);
          return;
        }
      }
      if (e instanceof ApiError && e.detail.code === LOGIN_ERROR.LOCKED)
        setMisses({ username: "", count: 0 });
      toast.fail(errorMessage(e, "Không đăng nhập được. Kiểm tra kết nối mạng rồi thử lại."));
    },
    onSuccess: (result, vars) => {
      saveSession(result.user, vars.remember);
      router.push("/");
    },
  });

  return (
    <div className={styles.page}>
      <div className={styles.formColumn}>
        <div className={styles.formBlock}>
          <Logo size={44} withAppName priority />

          <h1 className={styles.title}>Đăng nhập</h1>

          <form
            className={styles.form}
            onSubmit={handleSubmit((values) => submit.mutate(values), reportInvalid)}
            noValidate
          >
            <TextField
              label="Tài khoản"
              placeholder="Tên đăng nhập công ty cấp"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.username?.message}
              {...register("username")}
            />

            <PasswordField
              label="Mật khẩu"
              placeholder="Mật khẩu công ty cấp"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register("password")}
            />

            <Controller
              control={control}
              name="remember"
              render={({ field }) => (
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  label="Ghi nhớ đăng nhập"
                />
              )}
            />

            <Button type="submit" block large disabled={submit.isPending}>
              {submit.isPending ? "Đang kiểm tra…" : "Đăng nhập"}
            </Button>
          </form>
        </div>
      </div>

      <BrandPanel className={styles.brandColumn} />

      <Dialog
        open={warnOpen}
        title="Chậm thôi bạn ơi"
        onClose={() => setWarnOpen(false)}
        footer={<Button onClick={() => setWarnOpen(false)}>Đã hiểu</Button>}
      >
        <p>
          Sai mật khẩu {misses.count} lần rồi, {LOGIN_MAX_ATTEMPTS} lần sẽ bị khoá tài khoản{" "}
          {LOGIN_LOCK_MINUTES} phút.
        </p>
      </Dialog>
    </div>
  );
}

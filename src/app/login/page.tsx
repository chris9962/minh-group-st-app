"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { BrandPanel } from "@/components/brand/BrandPanel";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Logo } from "@/components/ui/Logo";
import { TextField } from "@/components/ui/TextField";
import { login } from "@/lib/api/auth";
import { LoginForm } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";
import { errorMessage, toast } from "@/lib/toast";

export default function LoginPage() {
  const router = useRouter();
  const saveSession = useSession((s) => s.login);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(LoginForm),
    defaultValues: { username: "", password: "", remember: false },
  });

  const submit = useMutation({
    mutationFn: login,
    // `fetch` hỏng vì mất mạng ném TypeError chứ không phải ApiError — bắt cả
    // hai ở đây, không thì lỗi đó rơi vào khoảng không và màn hình đứng im.
    onError: (e) =>
      toast.fail(errorMessage(e, "Không đăng nhập được. Kiểm tra kết nối mạng rồi thử lại.")),
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
            onSubmit={handleSubmit((values) => submit.mutate(values))}
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

            <TextField
              label="Mật khẩu"
              type="password"
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
    </div>
  );
}

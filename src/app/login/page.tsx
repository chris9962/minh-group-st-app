"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { BrandPanel } from "@/components/brand/BrandPanel";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Logo } from "@/components/ui/Logo";
import { TextField } from "@/components/ui/TextField";
import { ApiError, login } from "@/lib/api/auth";
import { LoginForm } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

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
    onSuccess: (result, vars) => {
      saveSession(result.user, vars.remember);
      router.push("/");
    },
  });

  const serverError =
    submit.error instanceof ApiError ? submit.error.detail : null;

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

            {serverError && (
              <Alert tone="error">
                {serverError.message}
                {typeof serverError.attemptsLeft === "number" && (
                  <> Còn {serverError.attemptsLeft} lần trước khi bị khoá.</>
                )}
              </Alert>
            )}

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

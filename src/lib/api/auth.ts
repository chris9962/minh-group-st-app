import { LoginResult, type LoginError, type LoginForm } from "@/lib/types";

/** Lỗi có mã — để giao diện phân biệt "sai thông tin" với "bị khoá". */
export class ApiError extends Error {
  constructor(public detail: LoginError) {
    super(detail.message);
    this.name = "ApiError";
  }
}

export async function login(form: LoginForm): Promise<LoginResult> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });

  const data = await res.json();
  if (!res.ok) throw new ApiError(data as LoginError);

  return LoginResult.parse(data);
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}

import { LOGIN_ERROR, LoginError, LoginResult, type LoginForm } from "@/lib/types";

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

  // Thân rỗng hoặc không phải JSON (500 trần của Next, trang lỗi của proxy)
  // làm `res.json()` ném SyntaxError — không phải ApiError, nên màn đăng nhập
  // không có gì để hiện và người dùng thấy nút bật lại mà không hiểu vì sao.
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = LoginError.safeParse(data);
    throw new ApiError(
      parsed.success
        ? parsed.data
        : {
            code: LOGIN_ERROR.BAD_CREDENTIALS,
            message: "Không đăng nhập được. Thử lại sau ít phút hoặc liên hệ quản trị hệ thống.",
          },
    );
  }

  return LoginResult.parse(data);
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}

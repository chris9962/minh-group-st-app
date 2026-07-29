import { HttpResponse, http } from "msw";
import { LOGIN_ERROR, Scope } from "@/lib/types";
import { sessionExpiry } from "@/store/session";
import { dashboardFor } from "./dashboard";
import { peopleFor } from "./people";
import { departments, mockUsers } from "./data";

/** Sai 5 lần liên tiếp thì khoá 15 phút — đếm theo tên đăng nhập. */
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

const failedAttempts = new Map<string, number>();
const lockedUntil = new Map<string, number>();

export const handlers = [
  http.post("/api/login", async ({ request }) => {
    const { username, password, remember } = (await request.json()) as {
      username: string;
      password: string;
      remember: boolean;
    };

    const key = username.trim().toLowerCase();
    const lockEnd = lockedUntil.get(key);

    if (lockEnd && lockEnd > Date.now()) {
      const minutes = Math.ceil((lockEnd - Date.now()) / 60_000);
      return HttpResponse.json(
        {
          code: LOGIN_ERROR.LOCKED,
          message: `Tài khoản đang bị khoá. Thử lại sau ${minutes} phút hoặc liên hệ quản trị hệ thống.`,
          lockedUntil: new Date(lockEnd).toISOString(),
        },
        { status: 423 },
      );
    }

    const account = mockUsers.find(
      (u) => u.username === key && u.password === password && u.active,
    );

    if (!account) {
      const attempts = (failedAttempts.get(key) ?? 0) + 1;
      failedAttempts.set(key, attempts);

      if (attempts >= MAX_ATTEMPTS) {
        lockedUntil.set(key, Date.now() + LOCK_MS);
        failedAttempts.delete(key);
        return HttpResponse.json(
          {
            code: LOGIN_ERROR.LOCKED,
            message:
              "Sai 5 lần liên tiếp — tài khoản bị khoá 15 phút. Liên hệ quản trị hệ thống để mở lại.",
          },
          { status: 423 },
        );
      }

      return HttpResponse.json(
        {
          code: LOGIN_ERROR.BAD_CREDENTIALS,
          message: "Tên đăng nhập hoặc mật khẩu không đúng.",
          attemptsLeft: MAX_ATTEMPTS - attempts,
        },
        { status: 401 },
      );
    }

    failedAttempts.delete(key);
    lockedUntil.delete(key);

    const { password: _omit, ...user } = account;
    void _omit;

    return HttpResponse.json({
      user,
      expiresAt: new Date(sessionExpiry(Boolean(remember))).toISOString(),
    });
  }),

  http.get("/api/dashboard", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const parsed = Scope.safeParse(params.get("scope"));
    return HttpResponse.json(
      dashboardFor(
        parsed.success ? parsed.data : "company",
        params.get("period") ?? "today",
      ),
    );
  }),

  http.get("/api/people", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const parsed = Scope.safeParse(params.get("scope"));
    return HttpResponse.json(
      peopleFor({
        scope: parsed.success ? parsed.data : "company",
        period: params.get("period") ?? "today",
        summaryMonth: params.get("summaryMonth") ?? "",
        departmentId: params.get("departmentId") || undefined,
        search: params.get("search") ?? "",
      }),
    );
  }),

  http.get("/api/departments", () =>
    HttpResponse.json(departments.filter((d) => d.active)),
  ),
];

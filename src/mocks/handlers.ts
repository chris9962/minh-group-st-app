import { HttpResponse, http } from "msw";
import { LOGIN_ERROR, Scope } from "@/lib/types";
import { sessionExpiry } from "@/store/session";
import { dashboardFor } from "./dashboard";
import { SAVE_ERROR, type StaffForm, type StaffQuery } from "@/lib/api/staff";
import { ORG_ERROR, type DepartmentForm, type OrgErrorCode } from "@/lib/api/org";
import { peopleFor } from "./people";
import { personFor } from "./person";
import {
  createDepartment,
  departmentDetailFor,
  departmentsFor,
  setDepartmentActive,
  updateDepartment,
} from "./org";
import {
  createStaff,
  findStaff,
  newPassword,
  setStaffActive,
  staffFor,
  updateStaff,
} from "./staff";
import { departments, mockUsers } from "./data";

/** Người bấm nút — máy chủ thật lấy từ phiên, ở đây gửi kèm cho gọn. */
const actorBy = (id: string) => mockUsers.find((u) => u.id === id) ?? null;

const saveError = (code: "username-taken" | "role-too-high") => ({
  code,
  message:
    code === SAVE_ERROR.USERNAME_TAKEN
      ? "Tên đăng nhập này đã có người dùng"
      : "Bạn không gán được chức vụ cao hơn quyền của chính mình",
});

const orgError = (code: OrgErrorCode) => ({
  code,
  message:
    code === ORG_ERROR.NAME_TAKEN
      ? "Đã có phòng tên này"
      : "Phòng này vẫn còn người — chuyển họ sang phòng khác trước",
});

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

  http.get("/api/people/:id", ({ params, request }) => {
    const search = new URL(request.url).searchParams;
    const person = personFor({
      id: String(params.id),
      period: search.get("period") ?? "today",
      summaryMonth: search.get("summaryMonth") ?? "",
    });
    if (!person) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(person);
  }),

  http.get("/api/staff", ({ request }) => {
    const params = new URL(request.url).searchParams;
    return HttpResponse.json(
      staffFor({
        scope: params.get("scope") ?? "company",
        departmentId: params.get("departmentId") ?? "",
        search: params.get("search") ?? "",
        status: (params.get("status") ?? "active") as "active" | "locked" | "all",
        roles: (params.get("roles") ?? "")
          .split(",")
          .filter(Boolean) as StaffQuery["roles"],
      }),
    );
  }),

  http.post("/api/staff", async ({ request }) => {
    const { actorId, ...form } = (await request.json()) as StaffForm & {
      actorId: string;
    };
    const result = createStaff(form, actorBy(actorId));
    return result.ok
      ? HttpResponse.json(result.staff, { status: 201 })
      : HttpResponse.json(saveError(result.code), { status: 422 });
  }),

  http.patch("/api/staff/:id", async ({ params, request }) => {
    const { actorId, ...form } = (await request.json()) as StaffForm & {
      actorId: string;
    };
    const result = updateStaff(String(params.id), form, actorBy(actorId));
    return result.ok
      ? HttpResponse.json(result.staff)
      : HttpResponse.json(saveError(result.code), { status: 422 });
  }),

  http.post("/api/staff/:id/active", async ({ params, request }) => {
    const { active } = (await request.json()) as { active: boolean };
    const staff = setStaffActive(String(params.id), active);
    return staff
      ? HttpResponse.json(staff)
      : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/staff/:id/reset-password", ({ params }) =>
    findStaff(String(params.id))
      ? HttpResponse.json({ password: newPassword() })
      : new HttpResponse(null, { status: 404 }),
  ),

  http.get("/api/departments", () =>
    HttpResponse.json(departments.filter((d) => d.active)),
  ),

  http.get("/api/org/departments", ({ request }) =>
    HttpResponse.json(
      departmentsFor(new URL(request.url).searchParams.get("search") ?? ""),
    ),
  ),

  http.get("/api/org/departments/:id", ({ params }) => {
    const detail = departmentDetailFor(String(params.id));
    return detail
      ? HttpResponse.json(detail)
      : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/org/departments", async ({ request }) => {
    const form = (await request.json()) as DepartmentForm;
    const result = createDepartment(form);
    return result.ok
      ? HttpResponse.json(result.department, { status: 201 })
      : HttpResponse.json(orgError(result.code), { status: 422 });
  }),

  http.post("/api/org/departments/:id", async ({ params, request }) => {
    const form = (await request.json()) as DepartmentForm;
    const result = updateDepartment(String(params.id), form);
    return result.ok
      ? HttpResponse.json(result.department)
      : HttpResponse.json(orgError(result.code), { status: 422 });
  }),

  http.post("/api/org/departments/:id/active", async ({ params, request }) => {
    const { active } = (await request.json()) as { active: boolean };
    const result = setDepartmentActive(String(params.id), active);
    if (!result) return new HttpResponse(null, { status: 404 });
    return result.ok
      ? HttpResponse.json(result.department)
      : HttpResponse.json(orgError(result.code), { status: 422 });
  }),
];

import { HttpResponse, http } from "msw";
import { LOGIN_ERROR, Scope } from "@/lib/types";
import { clampScope, visibleDepartmentIds } from "@/lib/permissions";
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
import type { CustomerForm } from "@/lib/api/customers";
import {
  createCustomer,
  customerDetailFor,
  customerSummary,
  customersFor,
  findCustomer,
  markGiftGiven,
  updateCustomer,
} from "./customers";
import type { BankAccountForm } from "@/lib/api/bankAccounts";
import { createBankAccount } from "./bankAccounts";
import type { InsuranceOrderForm } from "@/lib/api/insuranceOrders";
import { createInsuranceOrder } from "./insuranceOrders";
import type {
  CatalogItemForm,
  GiftRuleForm,
  GiftSimulateInput,
  InsurancePackageForm,
  KpiTargetForm,
  ServiceTypeForm,
} from "@/lib/api/settings";
import {
  createGiftItemRow,
  createGiftRule,
  createInsurancePackageRow,
  createServiceTypeRow,
  giftItemsFor,
  giftRulesFor,
  insurancePackagesFor,
  kpiTargetFor,
  moveGiftRule,
  serviceTypesFor,
  setGiftItemActiveRow,
  setGiftRuleActiveRow,
  setInsurancePackageActiveRow,
  setServiceTypeActiveRow,
  simulateGift,
  updateGiftRule,
  updateInsurancePackageRow,
  updateKpiTargetRow,
  updateServiceTypeRow,
} from "./settings";
import type { BankForm, CodeStatus, ReferralCodeForm } from "@/lib/api/bankCatalog";
import {
  banksFor,
  createBank,
  createReferralCode,
  referralCodesFor,
  setBankActive,
  updateBank,
} from "./bankCatalog";
import type { ChannelForm } from "@/lib/api/channelCatalog";
import { channelsFor, createChannel, updateChannel } from "./channelCatalog";
import type { HamletForm, WardForm } from "@/lib/api/wardCatalog";
import { createHamlet, createWard, wardsFor } from "./wardCatalog";
import type { ServiceForm } from "@/lib/api/services";
import { createService, servicesFor } from "./services";
import type { BankAccountQuery } from "@/lib/api/banking";
import { bankAccountDetailFor, bankAccountsFor } from "./banking";
import type { InsuranceQuery } from "@/lib/api/insurance";
import { insuranceDetailFor, insuranceOrdersFor } from "./insurance";

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

  /* ── Cấu hình — P-81…P-84 ─────────────────────────────────────────── */

  http.get("/api/settings/gift-rules", () => HttpResponse.json(giftRulesFor())),

  http.post("/api/settings/gift-rules", async ({ request }) => {
    const form = (await request.json()) as GiftRuleForm;
    return HttpResponse.json(createGiftRule(form), { status: 201 });
  }),

  http.patch("/api/settings/gift-rules/:id", async ({ params, request }) => {
    const form = (await request.json()) as GiftRuleForm;
    const result = updateGiftRule(String(params.id), form);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/settings/gift-rules/:id/move", async ({ params, request }) => {
    const { direction } = (await request.json()) as { direction: "up" | "down" };
    const result = moveGiftRule(String(params.id), direction);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/settings/gift-rules/:id/active", async ({ params, request }) => {
    const { active } = (await request.json()) as { active: boolean };
    const result = setGiftRuleActiveRow(String(params.id), active);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/settings/gift-rules/simulate", async ({ request }) => {
    const input = (await request.json()) as GiftSimulateInput;
    return HttpResponse.json(simulateGift(input));
  }),

  http.get("/api/settings/gift-items", () => HttpResponse.json(giftItemsFor())),

  http.post("/api/settings/gift-items", async ({ request }) => {
    const form = (await request.json()) as CatalogItemForm;
    return HttpResponse.json(createGiftItemRow(form), { status: 201 });
  }),

  http.post("/api/settings/gift-items/:id/active", async ({ params, request }) => {
    const { active } = (await request.json()) as { active: boolean };
    const result = setGiftItemActiveRow(String(params.id), active);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.get("/api/settings/insurance-packages", () =>
    HttpResponse.json(insurancePackagesFor()),
  ),

  http.post("/api/settings/insurance-packages", async ({ request }) => {
    const form = (await request.json()) as InsurancePackageForm;
    return HttpResponse.json(createInsurancePackageRow(form), { status: 201 });
  }),

  http.patch("/api/settings/insurance-packages/:id", async ({ params, request }) => {
    const form = (await request.json()) as InsurancePackageForm;
    const result = updateInsurancePackageRow(String(params.id), form);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/settings/insurance-packages/:id/active", async ({ params, request }) => {
    const { active } = (await request.json()) as { active: boolean };
    const result = setInsurancePackageActiveRow(String(params.id), active);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.get("/api/settings/kpi-target", () => HttpResponse.json(kpiTargetFor())),

  http.post("/api/settings/kpi-target", async ({ request }) => {
    const form = (await request.json()) as KpiTargetForm;
    return HttpResponse.json(updateKpiTargetRow(form));
  }),

  http.get("/api/settings/service-types", () => HttpResponse.json(serviceTypesFor())),

  http.post("/api/settings/service-types", async ({ request }) => {
    const form = (await request.json()) as ServiceTypeForm;
    return HttpResponse.json(createServiceTypeRow(form), { status: 201 });
  }),

  http.patch("/api/settings/service-types/:id", async ({ params, request }) => {
    const form = (await request.json()) as ServiceTypeForm;
    const result = updateServiceTypeRow(String(params.id), form);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/settings/service-types/:id/active", async ({ params, request }) => {
    const { active } = (await request.json()) as { active: boolean };
    const result = setServiceTypeActiveRow(String(params.id), active);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.get("/api/settings/banks", () => HttpResponse.json(banksFor())),

  http.post("/api/settings/banks", async ({ request }) => {
    const form = (await request.json()) as BankForm;
    return HttpResponse.json(createBank(form), { status: 201 });
  }),

  http.patch("/api/settings/banks/:id", async ({ params, request }) => {
    const form = (await request.json()) as BankForm;
    const result = updateBank(String(params.id), form);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/settings/banks/:id/active", async ({ params, request }) => {
    const { active } = (await request.json()) as { active: boolean };
    const result = setBankActive(String(params.id), active);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  http.get("/api/settings/referral-codes", ({ request }) => {
    const params = new URL(request.url).searchParams;
    return HttpResponse.json(
      referralCodesFor({
        bankId: params.get("bankId") ?? "",
        status: (params.get("status") ?? "") as CodeStatus | "",
      }),
    );
  }),

  http.post("/api/settings/referral-codes", async ({ request }) => {
    const form = (await request.json()) as ReferralCodeForm;
    return HttpResponse.json(createReferralCode(form), { status: 201 });
  }),

  /* ── P-70 · Danh mục kênh ─────────────────────────────────────────────── */

  http.get("/api/settings/channels", () => HttpResponse.json(channelsFor())),

  http.post("/api/settings/channels", async ({ request }) => {
    const form = (await request.json()) as ChannelForm;
    return HttpResponse.json(createChannel(form), { status: 201 });
  }),

  http.patch("/api/settings/channels/:id", async ({ params, request }) => {
    const form = (await request.json()) as ChannelForm;
    const result = updateChannel(String(params.id), form);
    return result ? HttpResponse.json(result) : new HttpResponse(null, { status: 404 });
  }),

  /* ── P-71 · Danh mục xã / ấp ──────────────────────────────────────────── */

  http.get("/api/settings/wards", () => HttpResponse.json(wardsFor())),

  http.post("/api/settings/wards", async ({ request }) => {
    const form = (await request.json()) as WardForm;
    return HttpResponse.json(createWard(form), { status: 201 });
  }),

  http.post("/api/settings/hamlets", async ({ request }) => {
    const form = (await request.json()) as HamletForm;
    const result = createHamlet(form);
    return result ? HttpResponse.json(result, { status: 201 }) : new HttpResponse(null, { status: 404 });
  }),

  /* ── Khách hàng — P-40 · P-41 · P-42 ─────────────────────────────────── */

  http.get("/api/customers", ({ request }) => {
    const search = new URL(request.url).searchParams.get("search") ?? "";
    return HttpResponse.json(customersFor(search));
  }),

  http.get("/api/customers/:id", ({ params, request }) => {
    const actorId = new URL(request.url).searchParams.get("actorId") ?? "";
    const detail = customerDetailFor(String(params.id), actorBy(actorId));
    return detail ? HttpResponse.json(detail) : new HttpResponse(null, { status: 404 });
  }),

  http.post("/api/customers", async ({ request }) => {
    const form = (await request.json()) as CustomerForm;
    const result = createCustomer(form);
    if (result.ok) return HttpResponse.json(result.customer, { status: 201 });
    return HttpResponse.json(
      {
        code: result.code,
        message: "CCCD này đã có hồ sơ trong hệ thống",
        existing: customerSummary(result.existing),
      },
      { status: 422 },
    );
  }),

  http.patch("/api/customers/:id", async ({ params, request }) => {
    const form = (await request.json()) as CustomerForm;
    const result = updateCustomer(String(params.id), form);
    if (!result) return new HttpResponse(null, { status: 404 });
    if (result.ok) return HttpResponse.json(result.customer);
    return HttpResponse.json(
      {
        code: result.code,
        message: "CCCD này đã có hồ sơ trong hệ thống",
        existing: customerSummary(result.existing),
      },
      { status: 422 },
    );
  }),

  /* ── P-20 · Mở tài khoản ngân hàng cho khách ──────────────────────────── */

  http.post("/api/bank-accounts", async ({ request }) => {
    const { actorId, ...form } = (await request.json()) as BankAccountForm & {
      actorId: string;
    };
    const customer = findCustomer(form.customerId);
    if (!customer) return new HttpResponse(null, { status: 404 });
    const actor = actorBy(actorId);
    const result = createBankAccount(form, customer, actor);
    if (!result) return new HttpResponse(null, { status: 422 });
    return HttpResponse.json(result, { status: 201 });
  }),

  /* ── Tạo đơn bảo hiểm — tự mua hoặc từ quà tặng ───────────────────────── */

  http.post("/api/insurance-orders", async ({ request }) => {
    const { actorId, ...form } = (await request.json()) as InsuranceOrderForm & {
      actorId: string;
    };
    const customer = findCustomer(form.customerId);
    if (!customer) return new HttpResponse(null, { status: 404 });
    const actor = actorBy(actorId);
    const orders = createInsuranceOrder(form, customer, actor);
    return HttpResponse.json({ orders }, { status: 201 });
  }),

  http.post("/api/customers/:id/gift-given", async ({ params, request }) => {
    const { item } = (await request.json()) as { item: string };
    const ok = markGiftGiven(String(params.id), item);
    return ok ? HttpResponse.json({ ok: true }) : new HttpResponse(null, { status: 404 });
  }),

  /* ── P-30 · Ghi dịch vụ · P-31 · Danh sách dịch vụ ────────────────────── */

  http.get("/api/services", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const actor = actorBy(params.get("actorId") ?? "");
    const requested = Scope.safeParse(params.get("scope"));
    const scope = clampScope(actor, "services", "view-detail", requested.success ? requested.data : null);
    return HttpResponse.json(
      servicesFor(
        {
          scope,
          serviceTypeId: params.get("serviceTypeId") ?? "",
          from: params.get("from") ?? "",
          to: params.get("to") ?? "",
          ward: params.get("ward") ?? "",
          staffId: params.get("staffId") ?? "",
        },
        visibleDepartmentIds(actor, scope),
      ),
    );
  }),

  http.post("/api/services", async ({ request }) => {
    const { actorId, ...form } = (await request.json()) as ServiceForm & { actorId: string };
    const customer = findCustomer(form.customerId);
    if (!customer) return new HttpResponse(null, { status: 404 });
    const actor = actorBy(actorId);
    if (!actor) return new HttpResponse(null, { status: 404 });
    const row = createService(form, customer, actor.id, actor.fullName, actor.departmentId);
    return HttpResponse.json(row, { status: 201 });
  }),

  /* ── P-21 · Danh sách tài khoản ngân hàng · P-22 · Chi tiết ───────────── */

  http.get("/api/bank-account-list", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const actor = actorBy(params.get("actorId") ?? "");
    const requested = Scope.safeParse(params.get("scope"));
    const scope = clampScope(
      actor,
      "banking",
      "view-detail",
      requested.success ? requested.data : null,
    );
    const query: BankAccountQuery = {
      scope,
      bankCode: params.get("bankCode") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      referralCode: params.get("referralCode") ?? "",
      channel: params.get("channel") ?? "",
      staffId: params.get("staffId") ?? "",
    };
    return HttpResponse.json(bankAccountsFor(query, visibleDepartmentIds(actor, scope)));
  }),

  http.get("/api/bank-account-list/:id", ({ params, request }) => {
    const search = new URL(request.url).searchParams;
    const actor = actorBy(search.get("actorId") ?? "");
    const scope = clampScope(actor, "banking", "view-detail", null);
    const detail = bankAccountDetailFor(String(params.id), visibleDepartmentIds(actor, scope));
    return detail ? HttpResponse.json(detail) : new HttpResponse(null, { status: 404 });
  }),

  /* ── P-13 · Danh sách đơn bảo hiểm · P-14 · Chi tiết ──────────────────── */

  http.get("/api/insurance-list", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const actor = actorBy(params.get("actorId") ?? "");
    const requested = Scope.safeParse(params.get("scope"));
    const scope = clampScope(
      actor,
      "insurance",
      "view-detail",
      requested.success ? requested.data : null,
    );
    const query: InsuranceQuery = {
      scope,
      status: params.get("status") ?? "",
      product: params.get("product") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      staffId: params.get("staffId") ?? "",
    };
    return HttpResponse.json(insuranceOrdersFor(query, visibleDepartmentIds(actor, scope)));
  }),

  http.get("/api/insurance-list/:id", ({ params, request }) => {
    const search = new URL(request.url).searchParams;
    const actor = actorBy(search.get("actorId") ?? "");
    const scope = clampScope(actor, "insurance", "view-detail", null);
    const detail = insuranceDetailFor(String(params.id), visibleDepartmentIds(actor, scope));
    return detail ? HttpResponse.json(detail) : new HttpResponse(null, { status: 404 });
  }),
];

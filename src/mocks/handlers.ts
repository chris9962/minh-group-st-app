import { HttpResponse, http } from "msw";
import { Scope } from "@/lib/types";
import { can, clampScope, scopeFor, visibleDepartmentIds } from "@/lib/permissions";
import type { AuditLogQuery } from "@/lib/api/auditLog";
import { auditLogFor } from "./auditLog";
import { dashboardFor } from "./dashboard";
import { peopleFor } from "./people";
import { personFor } from "./person";
import { mockUsers } from "./data";
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
import type { BankAccountFinishForm, BankAccountStartForm } from "@/lib/api/bankAccounts";
import {
  allManualAccounts,
  creatingCountForCode,
  deleteBankAccount,
  finishBankAccount,
  setAccountPhotos,
  startBankAccount,
} from "./bankAccounts";
import type { InsuranceOrderForm, InsuranceOrderStatus } from "@/lib/api/insuranceOrders";
import { createInsuranceOrder, setOrderPhoto, setOrderStatus } from "./insuranceOrders";
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
import { codeStatusOf, type BankForm, type CodeStatus, type ReferralCodeForm } from "@/lib/api/bankCatalog";
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
import type { AddProvinceForm, AddWardForm, HamletForm } from "@/lib/api/wardCatalog";
import {
  addProvince,
  addWard,
  createHamlet,
  provincesFor,
  referenceProvincesFor,
  referenceWardsFor,
} from "./wardCatalog";
import type { HospitalForm } from "@/lib/api/hospitalCatalog";
import { createHospital, hospitalsFor } from "./hospitalCatalog";
import type { ServiceForm } from "@/lib/api/services";
import { createService, servicesFor } from "./services";
import type { BankAccountQuery } from "@/lib/api/banking";
import { bankAccountDetailFor, bankAccountsFor } from "./banking";
import type { InsuranceQuery } from "@/lib/api/insurance";
import { insuranceDetailFor, insuranceOrdersFor } from "./insurance";

/** Người bấm nút — máy chủ thật lấy từ phiên, ở đây gửi kèm cho gọn. */
const actorBy = (id: string) => mockUsers.find((u) => u.id === id) ?? null;

/* Đăng nhập · nhân sự · phòng ban KHÔNG còn mock — đã có API thật
   (src/app/api/…, đọc Postgres). MSW mặc định bypass request không có
   handler nên các đường đó tự đi thẳng vào máy chủ. */

export const handlers = [

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
    const status = (params.get("status") ?? "") as CodeStatus | "";
    // "Đang giữ" không lưu tĩnh — đúng bằng số tài khoản đang `creating` tham
    // chiếu mã đó (mục 4.5), ghép vào đây trước khi trả JSON.
    const withHolding = referralCodesFor({ bankId: params.get("bankId") ?? "" }).map((c) => ({
      ...c,
      holding: creatingCountForCode(c.id),
    }));
    const filtered = status ? withHolding.filter((c) => codeStatusOf(c) === status) : withHolding;
    return HttpResponse.json(filtered);
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

  /* ── Tham chiếu — 34 tỉnh + 3.321 xã/phường thật, chỉ để tìm & chọn ───── */

  http.get("/api/reference/provinces", () => HttpResponse.json(referenceProvincesFor())),

  http.get("/api/reference/wards", ({ request }) => {
    const provinceId = new URL(request.url).searchParams.get("provinceId") ?? "";
    return HttpResponse.json(referenceWardsFor(provinceId));
  }),

  /* ── P-71 · Danh mục xã / ấp — danh mục thật, bắt đầu rỗng ────────────── */

  http.get("/api/settings/provinces", () => HttpResponse.json(provincesFor())),

  http.post("/api/settings/provinces", async ({ request }) => {
    const form = (await request.json()) as AddProvinceForm;
    const result = addProvince(form);
    return result ? HttpResponse.json(result, { status: 201 }) : new HttpResponse(null, { status: 422 });
  }),

  http.post("/api/settings/provinces/wards", async ({ request }) => {
    const form = (await request.json()) as AddWardForm;
    const result = addWard(form);
    return result ? HttpResponse.json(result, { status: 201 }) : new HttpResponse(null, { status: 422 });
  }),

  http.post("/api/settings/hamlets", async ({ request }) => {
    const form = (await request.json()) as HamletForm;
    const result = createHamlet(form);
    return result ? HttpResponse.json(result, { status: 201 }) : new HttpResponse(null, { status: 404 });
  }),

  /* ── P-2.5 · Danh mục bệnh viện ───────────────────────────────────────── */

  http.get("/api/settings/hospitals", () => HttpResponse.json(hospitalsFor())),

  http.post("/api/settings/hospitals", async ({ request }) => {
    const form = (await request.json()) as HospitalForm;
    return HttpResponse.json(createHospital(form), { status: 201 });
  }),

  /* ── Khách hàng — P-40 · P-41 · P-42 ─────────────────────────────────── */

  http.get("/api/customers", ({ request }) => {
    const params = new URL(request.url).searchParams;
    return HttpResponse.json(
      customersFor({
        search: params.get("search") ?? "",
        channel: params.get("channel") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
      }),
    );
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

  /* ── P-20 · Mở tài khoản ngân hàng cho khách — hai bước (spec §4.5) ───── */

  /** Bước 1 — chọn ngân hàng + mã, giữ chỗ ngay: tạo dòng `creating`. */
  http.post("/api/bank-accounts", async ({ request }) => {
    const { actorId, ...form } = (await request.json()) as BankAccountStartForm & {
      actorId: string;
    };
    const customer = findCustomer(form.customerId);
    if (!customer) return new HttpResponse(null, { status: 404 });
    const actor = actorBy(actorId);
    const result = startBankAccount(form, customer, actor);
    if (!result) return new HttpResponse(null, { status: 422 });
    return HttpResponse.json(result, { status: 201 });
  }),

  /** Bước 2 — điền nốt + đủ ảnh mới cho hoàn thành; mã bị tiêu thật ở đây. */
  http.patch("/api/bank-accounts/:id/finish", async ({ params, request }) => {
    const { accountNumber, openedDate, appInstalled, accountType, note } =
      (await request.json()) as BankAccountFinishForm & { actorId: string };
    const form: BankAccountFinishForm = { accountNumber, openedDate, appInstalled, accountType, note };
    const result = finishBankAccount(String(params.id), form);
    if (!result) return new HttpResponse(null, { status: 422 });
    return HttpResponse.json(result);
  }),

  /** Bỏ dở — chỉ xoá được khi còn `creating`, nhả mã lại kho ngay. */
  http.delete("/api/bank-accounts/:id", ({ params, request }) => {
    const search = new URL(request.url).searchParams;
    const actor = actorBy(search.get("actorId") ?? "");
    const scope = scopeFor(actor, "banking", "delete");
    if (!scope) return new HttpResponse(null, { status: 403 });

    const target = allManualAccounts().find((a) => a.id === String(params.id));
    const allowed = visibleDepartmentIds(actor, scope);
    if (
      !target ||
      (allowed !== null && (target.createdByDepartmentId === null || !allowed.includes(target.createdByDepartmentId)))
    ) {
      return new HttpResponse(null, { status: 404 });
    }

    const ok = deleteBankAccount(String(params.id));
    return ok ? new HttpResponse(null, { status: 204 }) : new HttpResponse(null, { status: 404 });
  }),

  /** Thêm/thay/xoá ảnh chứng minh ở P-22 — mỗi ngân hàng yêu cầu số ảnh riêng (P-60). */
  http.patch("/api/bank-accounts/:id/photos", async ({ params, request }) => {
    const { photoUrls } = (await request.json()) as { photoUrls: string[]; actorId: string };
    const updated = setAccountPhotos(String(params.id), photoUrls);
    return updated ? HttpResponse.json(updated) : new HttpResponse(null, { status: 404 });
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

  /**
   * P-16 · Nhận đơn / đánh dấu hoàn thành — chỉ Đội tạo đơn (quyền
   * `handle-fallback`) mới được bấm; ẩn nút ở giao diện không thay được kiểm
   * tra ở đây.
   */
  http.patch("/api/insurance-orders/:id/status", async ({ params, request }) => {
    const { status, actorId } = (await request.json()) as {
      status: InsuranceOrderStatus;
      actorId: string;
    };
    const actor = actorBy(actorId);
    if (!can(actor, "insurance", "handle-fallback")) {
      return new HttpResponse(null, { status: 403 });
    }
    const updated = setOrderStatus(String(params.id), status);
    return updated ? HttpResponse.json(updated) : new HttpResponse(null, { status: 404 });
  }),

  /** Đính/thay ảnh chứng nhận bảo hiểm — thay cho PDF, cho phép ở mọi trạng thái. */
  http.patch("/api/insurance-orders/:id/photo", async ({ params, request }) => {
    const { photoUrl } = (await request.json()) as { photoUrl: string; actorId: string };
    const updated = setOrderPhoto(String(params.id), photoUrl);
    return updated ? HttpResponse.json(updated) : new HttpResponse(null, { status: 404 });
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
          search: params.get("search") ?? "",
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
      search: params.get("search") ?? "",
      bankCode: params.get("bankCode") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      referralCode: params.get("referralCode") ?? "",
      channel: params.get("channel") ?? "",
      staffId: params.get("staffId") ?? "",
      status: (params.get("status") ?? "") as BankAccountQuery["status"],
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
      search: params.get("search") ?? "",
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

  /* ── P-93 · Nhật ký truy vết ───────────────────────────────────────────
     Không áp trục phạm vi theo phòng — hoặc thấy hết, hoặc không thấy gì.
     Chỉ GĐ · QTHT (spec) — gate bằng `manage-org` vì hai vai này luôn có nó,
     còn Kế toán tổng hợp thì không; `view-detail` không dùng được vì Kế toán
     tổng hợp cũng có qua wildcard `*` (đọc chéo mọi module nghiệp vụ). */

  http.get("/api/audit-log", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const actor = actorBy(params.get("actorId") ?? "");
    if (!can(actor, "system", "manage-org")) return new HttpResponse(null, { status: 403 });

    const query: AuditLogQuery = {
      staffId: params.get("staffId") ?? "",
      action: (params.get("action") ?? "") as AuditLogQuery["action"],
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
    };
    return HttpResponse.json(auditLogFor(query));
  }),
];

import { and, asc, count, desc, eq, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  KIND_LABEL,
  ReconcileStatus,
  SocialInsuranceKind,
  SocialInsurancePlan,
  type RecordEditForm,
  type SocialInsuranceFilters,
  type SocialInsuranceOptions,
  type SocialInsurancePage,
  type SocialInsuranceExportRow,
  type SocialInsuranceRow,
  type SocialInsuranceSort,
  type SocialInsuranceTotals,
} from "@/lib/api/socialInsurance";
import { applyRate, centsFromDecimal, decimalFromCents } from "@/lib/money";
import { recordInScope, recordVisibility, type RecordVisibility } from "@/lib/permissions";
import { searchTerms } from "@/lib/search";
import { SOCIAL_DEPARTMENT_CODE } from "@/lib/api/staff";
import { BUSINESS_TIMEZONE, roundPoints } from "@/lib/format";
import { isRealIsoDate, type User } from "@/lib/types";
import { isUuid, uuidParam } from "./auth";
import { closedMonthAmong, closedMonthMessage } from "./closedMonths";
import { db } from "./db/client";
import { collaborators, customers, departments, services, socialInsuranceRecords, users } from "./db/schema";
import type { PageArgs } from "./pagination";
import {
  atmStaffById,
  checkEntry,
  closedMonthsOf,
  collaboratorIds,
  lockSocialInsurance,
  monthLabel,
  recomputeEntryStaff,
  recomputeUploader,
  recordScopeWhere,
  type Conn,
  type EntryFieldErrors,
} from "./socialInsuranceImport";
import { rateBooksFor } from "./socialInsuranceRates";
import { socialInsuranceOfDepartment } from "./kpi";
import type { DepartmentSocialInsurance, SocialInsuranceRevenue } from "@/lib/api/org";

/**
 * Trang BHYT/BHXH, cùng khuôn với `server/vneid.ts`: phạm vi mức dòng theo
 * người tải file, lọc và cắt trang chỉ trên `social_insurance_records`, rồi mới
 * dán tên cho đúng một trang (AGENTS.md §5.2).
 */

const r = socialInsuranceRecords;
const entryStaff = alias(users, "entry_staff");
const uploader = alias(users, "uploader");
const entryDepartment = alias(departments, "entry_department");
const uploaderDepartment = alias(departments, "uploader_department");

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const socialInsuranceFiltersFrom = (params: URLSearchParams): SocialInsuranceFilters => {
  const kind = SocialInsuranceKind.safeParse(params.get("kind"));
  const plan = SocialInsurancePlan.safeParse(params.get("plan"));
  const status = ReconcileStatus.safeParse(params.get("status"));
  return {
    search: params.get("search") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    kind: kind.success ? kind.data : "",
    plan: plan.success ? plan.data : "",
    collaboratorId: uuidParam(params.get("collaboratorId")),
    uploadedBy: uuidParam(params.get("uploadedBy")),
    entryStaffId: uuidParam(params.get("entryStaffId")),
    status: status.success ? status.data : "",
  };
};

type Action = "view-detail" | "update" | "delete" | "export";
const scopeOf = (actor: User, action: Action) => recordVisibility(actor, "social-insurance", action);

function searchWhere(raw: string): SQL | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  return and(
    ...searchTerms(text).map(
      (term) =>
        sql`exists (
          select 1 from ${customers} c
          where c.id = ${r.customerId}
            and (c.search_name like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'
              or c.id_number like '%' || ${likeEscape(term)} || '%' escape '\\'
              or c.social_insurance_code like '%' || ${likeEscape(term)} || '%' escape '\\')
        )`,
    ),
  );
}

const mismatchSql = sql`(${r.reconciledPlan} <> ${r.plan} or ${r.reconciledMonths} <> ${r.months} or ${r.reconciledCollectedAmount} <> ${r.collectedAmount})`;

const statusWhere = (status: SocialInsuranceFilters["status"]): SQL | undefined => {
  if (status === "pending") return sql`${r.reconciledAt} is null`;
  if (status === "mismatch") return sql`${r.reconciledAt} is not null and ${mismatchSql}`;
  if (status === "matched") return sql`${r.reconciledAt} is not null and not ${mismatchSql}`;
  return undefined;
};

const filtersWhere = (visible: RecordVisibility, q: SocialInsuranceFilters): SQL | undefined => {
  const parts = [
    recordScopeWhere(visible),
    searchWhere(q.search),
    // So trên cột gốc theo giờ Việt Nam để dùng được chỉ mục, cùng cách màn VNeID.
    isRealIsoDate(q.from)
      ? sql`${r.createdAt} >= ((${q.from}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`
      : undefined,
    isRealIsoDate(q.to)
      ? sql`${r.createdAt} < ((${q.to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`
      : undefined,
    q.kind ? eq(r.kind, q.kind) : undefined,
    q.plan ? eq(r.plan, q.plan) : undefined,
    q.collaboratorId ? eq(r.collaboratorId, q.collaboratorId) : undefined,
    q.uploadedBy ? eq(r.uploadedBy, q.uploadedBy) : undefined,
    q.entryStaffId ? eq(r.entryStaffId, q.entryStaffId) : undefined,
    statusWhere(q.status),
  ].filter(Boolean) as SQL[];
  return parts.length > 0 ? and(...parts) : undefined;
};

const pickPage = (where: SQL | undefined, orderBy: SQL[], limit: number, offset: number) =>
  db
    .select({
      id: r.id,
      kind: r.kind,
      customerId: r.customerId,
      receiptMonth: r.receiptMonth,
      plan: r.plan,
      months: r.months,
      collectedAmount: r.collectedAmount,
      paidAmount: r.paidAmount,
      collaboratorId: r.collaboratorId,
      serviceId: r.serviceId,
      entryStaffId: r.entryStaffId,
      uploadedBy: r.uploadedBy,
      uploadedByDepartmentId: r.uploadedByDepartmentId,
      createdAt: r.createdAt,
      reconciledPlan: r.reconciledPlan,
      reconciledMonths: r.reconciledMonths,
      reconciledCollectedAmount: r.reconciledCollectedAmount,
      receivedAmount: r.receivedAmount,
      receivedRate: r.receivedRate,
      reconciledAt: r.reconciledAt,
    })
    .from(r)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset)
    .as("page");

const decorate = (page: ReturnType<typeof pickPage>) =>
  db
    .select({
      id: page.id,
      kind: page.kind,
      customerId: page.customerId,
      receiptMonth: page.receiptMonth,
      plan: page.plan,
      months: page.months,
      collectedAmount: page.collectedAmount,
      paidAmount: page.paidAmount,
      entryStaffId: page.entryStaffId,
      uploadedBy: page.uploadedBy,
      uploadedByDepartmentId: page.uploadedByDepartmentId,
      createdAt: page.createdAt,
      reconciledPlan: page.reconciledPlan,
      reconciledMonths: page.reconciledMonths,
      reconciledCollectedAmount: page.reconciledCollectedAmount,
      receivedAmount: page.receivedAmount,
      receivedRate: page.receivedRate,
      reconciledAt: page.reconciledAt,
      customerName: customers.fullName,
      idNumber: customers.idNumber,
      socialInsuranceCode: customers.socialInsuranceCode,
      collaboratorName: collaborators.name,
      entryStaffName: entryStaff.fullName,
      entryStaffCode: entryStaff.staffCode,
      entryStaffDepartmentName: entryDepartment.name,
      uploaderName: uploader.fullName,
      uploaderCode: uploader.staffCode,
      uploaderDepartmentName: uploaderDepartment.name,
      // Tháng biên lai giữ điểm An Sinh, tháng tải file giữ lượt nhập liệu: một trong hai đã chốt là khoá.
      monthClosed: sql<boolean>`exists (
        select 1 from salary_closings sc
        where sc.year_month in (${page.receiptMonth}, to_char(${services.serviceDate}, 'YYYY-MM'))
      )`,
    })
    .from(page)
    .innerJoin(customers, eq(customers.id, page.customerId))
    .innerJoin(services, eq(services.id, page.serviceId))
    .innerJoin(entryStaff, eq(entryStaff.id, page.entryStaffId))
    .innerJoin(uploader, eq(uploader.id, page.uploadedBy))
    .leftJoin(entryDepartment, eq(entryDepartment.id, services.createdByDepartmentId))
    .leftJoin(uploaderDepartment, eq(uploaderDepartment.id, page.uploadedByDepartmentId))
    .leftJoin(collaborators, eq(collaborators.id, page.collaboratorId));

/** `id` đứng cuối để hai hồ sơ cùng giờ tải không đổi chỗ giữa các trang. */
const orderOf = (t: { at: SQLWrapper; id: SQLWrapper }, dir: "asc" | "desc"): SQL[] =>
  dir === "asc" ? [asc(t.at), asc(t.id)] : [desc(t.at), asc(t.id)];

const orderedPage = (where: SQL | undefined, dir: "asc" | "desc", limit: number, offset: number) => {
  const page = pickPage(where, orderOf({ at: r.createdAt, id: r.id }, dir), limit, offset);
  return decorate(page).orderBy(...orderOf({ at: page.createdAt, id: page.id }, dir));
};

type Decorated = Awaited<ReturnType<typeof orderedPage>>[number];

/** CCCD chỉ trả 4 số cuối, cùng luật với mọi response khác. */
const toRow = (d: Decorated): SocialInsuranceRow => {
  return {
    id: d.id,
    kind: d.kind,
    customerId: d.customerId,
    customerName: d.customerName,
    idNumberTail: d.idNumber ? d.idNumber.slice(-4) : null,
    socialInsuranceCode: d.socialInsuranceCode,
    receiptMonth: d.receiptMonth,
    plan: d.plan,
    months: d.months,
    collectedCents: centsFromDecimal(d.collectedAmount),
    paidCents: centsFromDecimal(d.paidAmount),
    collaboratorName: d.collaboratorName,
    entryStaffId: d.entryStaffId,
    entryStaffName: d.entryStaffName,
    entryStaffCode: d.entryStaffCode,
    entryStaffDepartmentName: d.entryStaffDepartmentName,
    createdById: d.uploadedBy,
    createdByName: d.uploaderName,
    createdByCode: d.uploaderCode,
    createdByDepartmentName: d.uploaderDepartmentName,
    createdByDepartmentId: d.uploadedByDepartmentId,
    createdAt: d.createdAt.toISOString(),
    reconciliation:
      d.reconciledAt &&
      d.reconciledPlan &&
      d.reconciledMonths !== null &&
      d.reconciledCollectedAmount !== null &&
      d.receivedAmount !== null &&
      d.receivedRate !== null
        ? {
            plan: d.reconciledPlan,
            months: d.reconciledMonths,
            collectedCents: centsFromDecimal(d.reconciledCollectedAmount),
            receivedCents: centsFromDecimal(d.receivedAmount),
            receivedRate: d.receivedRate,
            paidCents: null,
            at: d.reconciledAt.toISOString(),
          }
        : null,
    monthClosed: d.monthClosed,
  };
};

/**
 * Điền tiền chi tính lại theo file đối chiếu. Tính lúc đọc theo % của tháng
 * biên lai, không lưu: file đối chiếu không có cột tiền chi.
 */
async function withReconciledPaid<T extends SocialInsuranceRow>(rows: T[]): Promise<T[]> {
  const reconciled = rows.filter((row) => row.reconciliation);
  if (reconciled.length === 0) return rows;
  const books = await rateBooksFor(reconciled.map((row) => row.receiptMonth));
  for (const row of reconciled) {
    const rec = row.reconciliation!;
    const rate = books.get(row.receiptMonth)?.get(row.kind, rec.plan, rec.months);
    rec.paidCents = rate ? applyRate(rec.collectedCents, rate.payRate) : null;
  }
  return rows;
}

const EMPTY_TOTALS: SocialInsuranceTotals = {
  rows: 0,
  customers: 0,
  collectedCents: 0,
  paidCents: 0,
  receivedCents: 0,
  bhyt: 0,
  bhxh: 0,
  newCount: 0,
  renewalCount: 0,
};

/** Ô tổng theo bộ lọc đang chọn. Tiền cộng ở Postgres bằng `numeric`, không qua số thực. */
async function totalsOf(where: SQL | undefined): Promise<SocialInsuranceTotals> {
  const [t] = await db
    .select({
      rows: count(),
      customers: sql<number>`count(distinct ${r.customerId})::int`,
      collected: sql<string>`coalesce(sum(${r.collectedAmount}), 0)::text`,
      paid: sql<string>`coalesce(sum(${r.paidAmount}), 0)::text`,
      received: sql<string>`coalesce(sum(${r.receivedAmount}), 0)::text`,
      bhyt: sql<number>`count(*) filter (where ${r.kind} = 'bhyt')::int`,
      bhxh: sql<number>`count(*) filter (where ${r.kind} = 'bhxh')::int`,
      newCount: sql<number>`count(*) filter (where ${r.plan} = 'new')::int`,
      renewalCount: sql<number>`count(*) filter (where ${r.plan} = 'renewal')::int`,
    })
    .from(r)
    .where(where);
  if (!t) return EMPTY_TOTALS;
  return {
    rows: t.rows,
    customers: t.customers,
    collectedCents: centsFromDecimal(t.collected),
    paidCents: centsFromDecimal(t.paid),
    receivedCents: centsFromDecimal(t.received),
    bhyt: t.bhyt,
    bhxh: t.bhxh,
    newCount: t.newCount,
    renewalCount: t.renewalCount,
  };
}

export async function listSocialInsurance(
  actor: User,
  filters: SocialInsuranceFilters,
  page: PageArgs<SocialInsuranceSort>,
): Promise<SocialInsurancePage> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return { rows: [], total: 0, totals: EMPTY_TOTALS };

  const where = filtersWhere(visible, filters);
  const [rows, totals] = await Promise.all([
    orderedPage(where, page.dir, page.limit, page.offset),
    totalsOf(where),
  ]);
  return { rows: await withReconciledPaid(rows.map(toRow)), total: totals.rows, totals };
}

const EXPORT_LIMIT = 20_000;

/** File Excel mang CCCD đủ 12 số: khách đối chiếu file 2 theo cột này. */
export async function listSocialInsuranceForExport(
  actor: User,
  filters: SocialInsuranceFilters,
): Promise<{ rows: SocialInsuranceExportRow[]; total: number }> {
  const visible = scopeOf(actor, "export");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = filtersWhere(visible, filters);
  const [rows, [totals]] = await Promise.all([
    orderedPage(where, "desc", EXPORT_LIMIT, 0),
    db.select({ value: count() }).from(r).where(where),
  ]);
  return {
    rows: await withReconciledPaid(rows.map((d) => ({ ...toRow(d), idNumber: d.idNumber }))),
    total: totals?.value ?? 0,
  };
}

/** Danh sách cho ô lọc: CTV dùng chung, người tải và nhân viên nhập liệu trong phạm vi người xem. */
export async function socialInsuranceOptions(actor: User): Promise<SocialInsuranceOptions> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return { collaborators: [], uploaders: [], entryStaff: [], atmStaff: [] };
  const scope = recordScopeWhere(visible);

  const [collaboratorRows, socialStaffRows, uploaderRows, entryRows, atmRows] = await Promise.all([
    db
      .select({ id: collaborators.id, name: collaborators.name })
      .from(collaborators)
      .orderBy(asc(collaborators.name)),
    // Ô lọc "Nhân viên" liệt kê cả người Phòng An Sinh chưa tải file nào.
    db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .innerJoin(departments, eq(departments.id, users.departmentId))
      .where(and(eq(departments.code, SOCIAL_DEPARTMENT_CODE), eq(users.active, true))),
    db
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(r)
      .innerJoin(users, eq(users.id, r.uploadedBy))
      .where(scope),
    db
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(r)
      .innerJoin(users, eq(users.id, r.entryStaffId))
      .where(scope),
    db
      .select({ id: users.id, name: users.fullName, code: users.staffCode })
      .from(users)
      .where(and(eq(users.active, true), eq(users.salaryScheme, "atm"))),
  ]);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "vi");
  return {
    collaborators: collaboratorRows,
    uploaders: [...new Map([...socialStaffRows, ...uploaderRows].map((u) => [u.id, u])).values()].sort(byName),
    entryStaff: entryRows.sort(byName),
    atmStaff: atmRows.sort(byName),
  };
}

const recordById = async (id: string): Promise<SocialInsuranceRow | null> => {
  const [row] = await orderedPage(eq(r.id, id), "desc", 1, 0);
  return row ? (await withReconciledPaid([toRow(row)]))[0] : null;
};

type FormErrors = Partial<Record<keyof RecordEditForm, string>>;

export type RecordOutcome =
  | { ok: true; record: SocialInsuranceRow }
  | { ok: false; message: string; fieldErrors?: FormErrors };

const STAFF_MISSING = "Chọn một nhân viên Điểm ATM đang làm";

/** Lỗi theo ô của file 1 đổi sang tên ô của form Sửa: ô mã nhân viên là ô chọn nhân viên. */
const formErrorsOf = ({ staffCode, ...rest }: EntryFieldErrors): FormErrors =>
  staffCode ? { ...rest, entryStaffId: staffCode } : rest;

/** Đọc lại dòng SAU khi xin khoá: hai lượt sửa hay xoá cùng lúc thấy đúng trạng thái của nhau. */
async function lockedRecord(tx: Conn, id: string) {
  const [row] = await tx
    .select({
      kind: r.kind,
      customerId: r.customerId,
      receiptMonth: r.receiptMonth,
      createdById: r.uploadedBy,
      createdByDepartmentId: r.uploadedByDepartmentId,
      serviceId: r.serviceId,
      serviceStaffId: services.createdBy,
      serviceDate: services.serviceDate,
    })
    .from(r)
    .innerJoin(services, eq(services.id, r.serviceId))
    .where(eq(r.id, id));
  return row ?? null;
}

/**
 * Sửa một dòng bằng đúng luật kiểm của file 1. Khách và loại không đổi được:
 * đổi chúng thì xoá dòng rồi nhập lại. Đổi nhân viên nhập liệu thì lượt nhập
 * liệu chuyển sang người mới, và điểm của cả hai người được tính lại.
 *
 * `null` = không có HOẶC ngoài phạm vi, route trả 404 giống nhau.
 */
export async function updateSocialInsurance(
  actor: User,
  id: string,
  form: RecordEditForm,
): Promise<RecordOutcome | null> {
  const outcome = await db.transaction(async (tx): Promise<
    | null
    | { ok: false; message: string; fieldErrors?: FormErrors }
    | { ok: true; staffIds: string[]; serviceDate: string; uploaderId: string; receiptMonths: string[] }
  > => {
    await lockSocialInsurance(tx);
    const current = await lockedRecord(tx, id);
    if (!current || !recordInScope(scopeOf(actor, "update"), current)) return null;

    const staff = isUuid(form.entryStaffId) ? await atmStaffById(form.entryStaffId, tx) : null;
    if (!staff) return { ok: false, message: STAFF_MISSING, fieldErrors: { entryStaffId: STAFF_MISSING } };

    const serviceMonth = current.serviceDate.slice(0, 7);
    const months = [current.receiptMonth, form.receiptMonth];
    // `checkEntry` tra nhân viên theo mã của file 1; form đã chọn sẵn nhân viên nên đưa vào dưới một khoá cố định.
    const chosen = "CHOSEN";
    const ctx = {
      kind: current.kind,
      staffOf: new Map([[chosen, staff]]),
      rateBooks: await rateBooksFor(months, tx),
      closedMonths: await closedMonthsOf([...months, serviceMonth], tx),
    };
    for (const month of [current.receiptMonth, serviceMonth])
      if (ctx.closedMonths.has(month)) return { ok: false, message: closedMonthMessage(month) };

    const { errors, fieldErrors, entry } = checkEntry(
      {
        receiptDate: form.receiptMonth,
        plan: form.plan === "new" ? "Tăng mới" : "Tái tục",
        months: form.months,
        collected: form.collected,
        paid: form.paid,
        staffCode: chosen,
        collaborator: form.collaborator,
      },
      ctx,
    );
    if (!entry) return { ok: false, message: errors.join(". "), fieldErrors: formErrorsOf(fieldErrors) };

    const [clash] = await tx
      .select({ id: r.id })
      .from(r)
      .where(
        and(
          eq(r.kind, current.kind),
          eq(r.customerId, current.customerId),
          eq(r.receiptMonth, entry.receiptMonth),
          ne(r.id, id),
        ),
      )
      .limit(1);
    if (clash) {
      const message = `Khách đã có hồ sơ ${KIND_LABEL[current.kind]} tháng ${monthLabel(entry.receiptMonth)}`;
      return { ok: false, message, fieldErrors: { receiptMonth: message } };
    }

    const collaboratorOf = await collaboratorIds([entry.collaborator], tx);
    await tx
      .update(r)
      .set({
        receiptMonth: entry.receiptMonth,
        plan: entry.plan,
        months: entry.months,
        collectedAmount: decimalFromCents(entry.collectedCents),
        paidAmount: decimalFromCents(entry.paidCents),
        collaboratorId: entry.collaborator ? (collaboratorOf.get(entry.collaborator) ?? null) : null,
        entryStaffId: entry.staff.id,
        updatedAt: new Date(),
      })
      .where(eq(r.id, id));

    // So với người đang giữ lượt dịch vụ, không so với cột của dòng: hai chỗ này lệch thì vẫn tính lại đúng người.
    const staffIds = current.serviceStaffId === entry.staff.id ? [] : [current.serviceStaffId, entry.staff.id];
    if (staffIds.length > 0)
      await tx
        .update(services)
        .set({ createdBy: entry.staff.id, createdByDepartmentId: entry.staff.departmentId })
        .where(eq(services.id, current.serviceId));
    return {
      ok: true,
      staffIds,
      serviceDate: current.serviceDate,
      uploaderId: current.createdById,
      receiptMonths: [current.receiptMonth, entry.receiptMonth],
    };
  });

  if (!outcome) return null;
  if (!outcome.ok) return outcome;
  await recomputeEntryStaff(outcome.staffIds, outcome.serviceDate);
  await recomputeUploader(outcome.uploaderId, outcome.receiptMonths);
  return { ok: true, record: (await recordById(id))! };
}

/** Xoá dòng và lượt nhập liệu của nhân viên ATM đi kèm. */
export async function deleteSocialInsurance(actor: User, id: string): Promise<RecordOutcome | null> {
  const record = await recordById(id);
  if (!record) return null;

  const outcome = await db.transaction(async (tx) => {
    await lockSocialInsurance(tx);
    const current = await lockedRecord(tx, id);
    if (!current || !recordInScope(scopeOf(actor, "delete"), current)) return null;
    const closed = await closedMonthAmong([current.receiptMonth, current.serviceDate.slice(0, 7)], tx);
    if (closed) return { ok: false as const, message: closedMonthMessage(closed) };

    await tx.delete(r).where(eq(r.id, id));
    await tx.delete(services).where(eq(services.id, current.serviceId));
    return { ok: true as const, current };
  });

  if (!outcome) return null;
  if (!outcome.ok) return outcome;
  await recomputeEntryStaff([outcome.current.serviceStaffId], outcome.current.serviceDate);
  await recomputeUploader(outcome.current.createdById, [outcome.current.receiptMonth]);
  return { ok: true, record };
}

const emptyRevenue = (): SocialInsuranceRevenue => ({ records: 0, collectedCents: 0, points: 0 });

const addRevenue = (to: SocialInsuranceRevenue, from: SocialInsuranceRevenue) => {
  to.records += from.records;
  to.collectedCents += from.collectedCents;
  to.points = roundPoints(to.points + from.points);
};

/** Trang chi tiết Phòng An Sinh: doanh thu theo nhóm loại và phương án, và theo từng người tải file. */
export async function departmentSocialInsurance(
  departmentId: string,
  yearMonth: string,
): Promise<DepartmentSocialInsurance> {
  const rows = await socialInsuranceOfDepartment(departmentId, yearMonth);
  const groups = SocialInsuranceKind.options.flatMap((kind) =>
    SocialInsurancePlan.options.map((plan) => ({ kind, plan, ...emptyRevenue() })),
  );
  const people = new Map<string, DepartmentSocialInsurance["people"][number]>();
  for (const row of rows) {
    addRevenue(groups.find((g) => g.kind === row.kind && g.plan === row.plan)!, row);
    let person = people.get(row.uploadedBy);
    if (!person) {
      person = { userId: row.uploadedBy, bhyt: emptyRevenue(), bhxh: emptyRevenue() };
      people.set(row.uploadedBy, person);
    }
    addRevenue(person[row.kind], row);
  }
  return { groups, people: [...people.values()] };
}

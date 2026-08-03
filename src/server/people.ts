import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { PeopleData, PersonScore } from "@/lib/api/people";
import type { PersonDetail } from "@/lib/api/person";
import { matchesSearch } from "@/lib/format";
import { clampScope, visibleDepartmentIds } from "@/lib/permissions";
import { Scope, type User } from "@/lib/types";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  customers,
  departments,
  giftGrants,
  insuranceOrders,
  kpiTargets,
  services,
  serviceTypes,
  users,
} from "./db/schema";

/**
 * P-51 · P-52 — điểm KPI tính SỐNG từ bản ghi nghiệp vụ × hệ số danh mục
 * (mgst-db-design.md §9: điểm không lưu). Bảng nghiệp vụ còn trống thì điểm
 * bằng 0 thật — không phải số bịa; dữ liệu vào tới đâu số đúng tới đó.
 *
 * Điểm ngân hàng = Σ hệ số của tài khoản `done` ĐÃ CÀI APP trong kỳ.
 * Điểm dịch vụ = Σ hệ số loại dịch vụ trong kỳ.
 */

const PRODUCT_LABEL = { motorbike: "BH xe máy", "electric-accident": "BH tai nạn điện" } as const;

type Period = { from: string; to: string };

const monthRange = (yearMonth: string): Period => {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(last).padStart(2, "0")}` };
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const periodOf = (period: string): Period =>
  period === "today" ? { from: todayIso(), to: todayIso() } : monthRange(period);

/** Chỉ tiêu tháng: mốc riêng của phòng đè mốc chung; chưa đặt tháng nào thì lấy mốc chung mới nhất. */
async function targetFor(yearMonth: string, departmentId: string | null): Promise<number> {
  const rows = await db.select().from(kpiTargets);
  const byDept = departmentId
    ? rows.find((r) => r.yearMonth === yearMonth && r.departmentId === departmentId)
    : undefined;
  const company = rows.find((r) => r.yearMonth === yearMonth && r.departmentId === null);
  const latestCompany = rows
    .filter((r) => r.departmentId === null)
    .sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1))[0];
  return (byDept ?? company ?? latestCompany)?.monthlyPoints ?? 100;
}

type Aggregates = {
  accounts: number;
  apps: number;
  bankingPoints: number;
  servicePoints: number;
  insuranceOrders: number;
};

/** Ba câu GROUP BY cho MỌI người một lượt — không truy vấn từng người (§11.1). */
async function aggregatesByUser(range: Period): Promise<Map<string, Aggregates>> {
  const map = new Map<string, Aggregates>();
  const entry = (id: string | null): Aggregates => {
    const key = id ?? "";
    let a = map.get(key);
    if (!a) {
      a = { accounts: 0, apps: 0, bankingPoints: 0, servicePoints: 0, insuranceOrders: 0 };
      map.set(key, a);
    }
    return a;
  };

  const bankRows = await db
    .select({
      createdBy: bankAccounts.createdBy,
      accounts: sql<number>`count(*)::int`,
      apps: sql<number>`count(*) filter (where ${bankAccounts.appInstalled})::int`,
      points: sql<number>`coalesce(sum(${banks.coefficient}) filter (where ${bankAccounts.appInstalled}), 0)::float`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, range.from),
        lte(bankAccounts.openedDate, range.to),
      ),
    )
    .groupBy(bankAccounts.createdBy);
  for (const r of bankRows) {
    const a = entry(r.createdBy);
    a.accounts = r.accounts;
    a.apps = r.apps;
    a.bankingPoints = r.points;
  }

  const serviceRows = await db
    .select({
      createdBy: services.createdBy,
      points: sql<number>`coalesce(sum(${serviceTypes.coefficient}), 0)::float`,
    })
    .from(services)
    .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
    .where(and(gte(services.serviceDate, range.from), lte(services.serviceDate, range.to)))
    .groupBy(services.createdBy);
  for (const r of serviceRows) entry(r.createdBy).servicePoints = r.points;

  const orderRows = await db
    .select({ createdBy: insuranceOrders.createdBy, n: sql<number>`count(*)::int` })
    .from(insuranceOrders)
    .where(and(gte(insuranceOrders.startDate, range.from), lte(insuranceOrders.startDate, range.to)))
    .groupBy(insuranceOrders.createdBy);
  for (const r of orderRows) entry(r.createdBy).insuranceOrders = r.n;

  return map;
}

const EMPTY: Aggregates = { accounts: 0, apps: 0, bankingPoints: 0, servicePoints: 0, insuranceOrders: 0 };

const daysLeftOf = (yearMonth: string): number => {
  const now = new Date();
  if (yearMonth !== now.toISOString().slice(0, 7)) return 0;
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return last - now.getUTCDate();
};

export async function peopleFor(
  actor: User,
  query: { scope: string; period: string; summaryMonth: string; departmentId: string; search: string },
): Promise<PeopleData> {
  const requested = Scope.safeParse(query.scope);
  const scope = clampScope(actor, "staff", "view-detail", requested.success ? requested.data : null);
  const visible = visibleDepartmentIds(actor, scope);

  const rows =
    visible !== null && visible.length === 0
      ? []
      : await db
          .select({ user: users, departmentName: departments.name })
          .from(users)
          .innerJoin(departments, eq(departments.id, users.departmentId))
          .where(visible === null ? undefined : inArray(users.departmentId, visible))
          .limit(500);

  const byDepartment = query.departmentId
    ? rows.filter((r) => r.user.departmentId === query.departmentId)
    : rows;

  const summaryMonth = query.summaryMonth || new Date().toISOString().slice(0, 7);
  const [periodAgg, monthAgg] = await Promise.all([
    aggregatesByUser(periodOf(query.period || "today")),
    aggregatesByUser(monthRange(summaryMonth)),
  ]);

  const target = await targetFor(summaryMonth, null);

  const toScore = (r: (typeof rows)[number], agg: Map<string, Aggregates>): PersonScore => {
    const a = agg.get(r.user.id) ?? EMPTY;
    return {
      id: r.user.id,
      fullName: r.user.fullName,
      departmentName: r.departmentName,
      bankingPoints: Math.round(a.bankingPoints),
      servicePoints: Math.round(a.servicePoints),
      accounts: a.accounts,
      apps: a.apps,
      insuranceOrders: a.insuranceOrders,
      target,
    };
  };

  const monthScores = byDepartment.map((r) => toScore(r, monthAgg));
  const onTarget = monthScores.filter((p) => p.bankingPoints + p.servicePoints >= p.target).length;

  const people = byDepartment
    .map((r) => toScore(r, periodAgg))
    .filter((p) => !query.search || matchesSearch(`${p.fullName} ${p.departmentName}`, query.search));

  return {
    summaryMonth,
    daysLeft: daysLeftOf(summaryMonth),
    summary: {
      headcount: monthScores.length,
      onTarget,
      offTarget: monthScores.length - onTarget,
      averagePoints: monthScores.length
        ? Math.round(
            monthScores.reduce((s, p) => s + p.bankingPoints + p.servicePoints, 0) / monthScores.length,
          )
        : 0,
    },
    people,
  };
}

export async function personFor(
  id: string,
  query: { period: string; summaryMonth: string },
): Promise<PersonDetail | null> {
  const rows = await db
    .select({ user: users, departmentName: departments.name })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const summaryMonth = query.summaryMonth || new Date().toISOString().slice(0, 7);
  const month = monthRange(summaryMonth);
  const range = periodOf(query.period || "today");

  /* Hoạt động trong KỲ đang xem — bảng còn trống thì các mảng rỗng, thẻ tự ẩn. */
  const accountRows = await db
    .select({
      account: bankAccounts,
      bankCode: banks.code,
      customerName: customers.fullName,
      referralCode: sql<string>`(select code from referral_codes rc where rc.id = ${bankAccounts.referralCodeId})`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(
      and(
        eq(bankAccounts.createdBy, id),
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, range.from),
        lte(bankAccounts.openedDate, range.to),
      ),
    )
    .limit(500);

  const orderRows = await db
    .select({ order: insuranceOrders, customerName: customers.fullName })
    .from(insuranceOrders)
    .innerJoin(customers, eq(customers.id, insuranceOrders.customerId))
    .where(
      and(
        eq(insuranceOrders.createdBy, id),
        gte(insuranceOrders.startDate, range.from),
        lte(insuranceOrders.startDate, range.to),
      ),
    )
    .limit(500);

  const serviceRows = await db
    .select({
      service: services,
      typeName: serviceTypes.name,
      coefficient: serviceTypes.coefficient,
      customerName: customers.fullName,
    })
    .from(services)
    .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
    .innerJoin(customers, eq(customers.id, services.customerId))
    .where(
      and(
        eq(services.createdBy, id),
        gte(services.serviceDate, range.from),
        lte(services.serviceDate, range.to),
      ),
    )
    .limit(500);

  /* Quà: khách trong danh sách tài khoản kỳ này của người này. */
  const customerIds = [...new Set(accountRows.map((r) => r.account.customerId))];
  const grants =
    customerIds.length > 0
      ? await db
          .select({ grant: giftGrants, customerName: customers.fullName })
          .from(giftGrants)
          .innerJoin(customers, eq(customers.id, giftGrants.customerId))
          .where(inArray(giftGrants.customerId, customerIds))
      : [];

  /* Điểm tháng (phần tóm tắt) + 5 tháng gần nhất. */
  const monthAgg = (await aggregatesByUser(month)).get(id) ?? EMPTY;
  const target = await targetFor(summaryMonth, row.user.departmentId);

  const [y, m] = summaryMonth.split("-").map(Number);
  const monthlyPoints: { month: string; points: number }[] = [];
  for (let back = 4; back >= 0; back--) {
    const d = new Date(Date.UTC(y, m - 1 - back, 1));
    const ym = d.toISOString().slice(0, 7);
    const agg = (await aggregatesByUser(monthRange(ym))).get(id) ?? EMPTY;
    monthlyPoints.push({ month: ym, points: Math.round(agg.bankingPoints + agg.servicePoints) });
  }

  const coefficientByCode = new Map(
    (await db.select({ code: banks.code, coefficient: banks.coefficient }).from(banks)).map(
      (b) => [b.code, Number(b.coefficient)],
    ),
  );

  const pointSources = [
    ...accountRows
      .filter((r) => r.account.appInstalled)
      .map((r) => ({
        label: r.bankCode,
        detail: `${r.customerName} · ${r.account.openedDate ?? ""}`,
        points: coefficientByCode.get(r.bankCode) ?? 1,
      })),
    ...serviceRows.map((r) => ({
      label: r.typeName,
      detail: `${r.customerName} · ${r.service.serviceDate}`,
      points: Number(r.coefficient),
    })),
  ];

  return {
    id: row.user.id,
    fullName: row.user.fullName,
    username: row.user.username,
    phone: row.user.phone,
    departmentName: row.departmentName ?? "",
    joinedMonth: row.user.createdAt.toISOString().slice(0, 7),
    summaryMonth,
    daysLeft: daysLeftOf(summaryMonth),
    points: {
      banking: Math.round(monthAgg.bankingPoints),
      service: Math.round(monthAgg.servicePoints),
      total: Math.round(monthAgg.bankingPoints + monthAgg.servicePoints),
      target,
    },
    pointSources,
    monthlyPoints,
    gifts: grants.map((g) => ({
      customerName: g.customerName,
      items: [(g.grant.chosenItem || "").toString()].filter(Boolean),
      eligible: true,
    })),
    accounts: accountRows.map((r) => ({
      id: r.account.id,
      date: r.account.openedDate ?? "",
      customerName: r.customerName,
      bankName: r.bankCode,
      referralCode: r.referralCode ?? "",
      channel: r.account.channelDetail,
      appInstalled: r.account.appInstalled,
      accountType: r.account.accountType,
    })),
    insurance: orderRows.map((r) => ({
      id: r.order.id,
      date: r.order.startDate,
      customerName: r.customerName,
      product: PRODUCT_LABEL[r.order.product],
      packageName: r.order.packageName,
      status: r.order.status,
    })),
    services: serviceRows.map((r) => ({
      id: r.service.id,
      date: r.service.serviceDate,
      customerName: r.customerName,
      serviceType: r.typeName,
      ward: r.service.wardName ?? "",
      points: Number(r.coefficient),
    })),
  };
}

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { PeopleData, PersonScore } from "@/lib/api/people";
import type { PersonDetail } from "@/lib/api/person";
import { businessDay, businessMonth, matchesSearch } from "@/lib/format";
import { clampScope, inVisibleScope, visibleDepartmentIds } from "@/lib/permissions";
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

/** `YYYY-MM` hợp lệ. Chuỗi bậy đi thẳng vào SQL thành `garbage-01` và vỡ 500. */
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isYearMonth = (v: string): boolean => YEAR_MONTH.test(v);

/** `period` chỉ nhận `today` hoặc `YYYY-MM` — dùng ở route để trả 400 thay vì 500. */
export const isPeriod = (v: string): boolean => v === "today" || isYearMonth(v);

const monthRange = (yearMonth: string): Period => {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(last).padStart(2, "0")}` };
};

const todayIso = (): string => businessDay();

const periodOf = (period: string): Period =>
  period === "today" ? { from: todayIso(), to: todayIso() } : monthRange(period);

/**
 * Tra chỉ tiêu tháng cho nhiều phòng một lượt.
 *
 * Thứ tự rơi: mốc riêng của phòng → mốc chung của tháng đó → mốc chung GẦN NHẤT
 * MÀ KHÔNG VƯỢT tháng đang xem → 100. Chặn ở "không vượt" là cố ý: lấy mốc mới
 * nhất bất kể tháng thì đặt mốc cho tháng sau xong, mọi tháng CŨ chưa có mốc
 * riêng đều bị chấm lại theo con số tương lai, và biểu đồ quá khứ tự viết lại.
 */
async function targetsFor(
  yearMonth: string,
  departmentIds: (string | null)[],
): Promise<Map<string | null, number>> {
  const rows = await db.select().from(kpiTargets);
  const company = rows.find((r) => r.yearMonth === yearMonth && r.departmentId === null);
  const latestCompany = rows
    .filter((r) => r.departmentId === null && r.yearMonth <= yearMonth)
    .sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1))[0];
  const fallback = (company ?? latestCompany)?.monthlyPoints ?? 100;

  const map = new Map<string | null, number>();
  for (const departmentId of new Set(departmentIds)) {
    const byDept = departmentId
      ? rows.find((r) => r.yearMonth === yearMonth && r.departmentId === departmentId)
      : undefined;
    map.set(departmentId, byDept?.monthlyPoints ?? fallback);
  }
  return map;
}

const targetFor = async (yearMonth: string, departmentId: string | null): Promise<number> =>
  (await targetsFor(yearMonth, [departmentId])).get(departmentId) ?? 100;

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
      // CNKD/HKD có `counts_as_app = false`: vẫn TÍNH ĐIỂM nhưng không đếm vào
      // tổng app, nên hai cột này lọc khác nhau (mgst-db-design.md §9).
      apps: sql<number>`count(*) filter (where ${bankAccounts.appInstalled} and ${banks.countsAsApp})::int`,
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

/**
 * Điểm từng tháng của MỘT người trong cả dải — hai câu GROUP BY theo tháng,
 * không phải một lượt quét cho mỗi tháng (§11.1 cấm N+1).
 */
async function monthlyPointsFor(
  userId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const points = new Map<string, number>();
  const add = (ym: string, n: number) => points.set(ym, (points.get(ym) ?? 0) + n);

  const bankRows = await db
    .select({
      ym: sql<string>`to_char(${bankAccounts.openedDate}, 'YYYY-MM')`,
      points: sql<number>`coalesce(sum(${banks.coefficient}) filter (where ${bankAccounts.appInstalled}), 0)::float`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        eq(bankAccounts.createdBy, userId),
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, from),
        lte(bankAccounts.openedDate, to),
      ),
    )
    .groupBy(sql`to_char(${bankAccounts.openedDate}, 'YYYY-MM')`);
  for (const r of bankRows) add(r.ym, r.points);

  const serviceRows = await db
    .select({
      ym: sql<string>`to_char(${services.serviceDate}, 'YYYY-MM')`,
      points: sql<number>`coalesce(sum(${serviceTypes.coefficient}), 0)::float`,
    })
    .from(services)
    .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
    .where(
      and(
        eq(services.createdBy, userId),
        gte(services.serviceDate, from),
        lte(services.serviceDate, to),
      ),
    )
    .groupBy(sql`to_char(${services.serviceDate}, 'YYYY-MM')`);
  for (const r of serviceRows) add(r.ym, r.points);

  return new Map([...points].map(([ym, n]) => [ym, Math.round(n)]));
}

const daysLeftOf = (yearMonth: string): number => {
  const today = businessDay();
  if (yearMonth !== today.slice(0, 7)) return 0;
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - d;
};

export async function peopleFor(
  actor: User,
  query: { scope: string; period: string; summaryMonth: string; departmentId: string; search: string },
): Promise<PeopleData> {
  const requested = Scope.safeParse(query.scope);
  const scope = clampScope(actor, "staff", "view-detail", requested.success ? requested.data : null);
  const visible = visibleDepartmentIds(actor, scope);

  // leftJoin, KHÔNG innerJoin: `users.department_id` để trống với ban giám đốc,
  // innerJoin thì họ rơi khỏi cả danh sách lẫn các số tóm tắt mà không báo gì.
  const rows =
    visible !== null && visible.length === 0
      ? []
      : await db
          .select({ user: users, departmentName: departments.name })
          .from(users)
          .leftJoin(departments, eq(departments.id, users.departmentId))
          .where(visible === null ? undefined : inArray(users.departmentId, visible))
          .orderBy(asc(users.fullName))
          .limit(500);

  const byDepartment = query.departmentId
    ? rows.filter((r) => r.user.departmentId === query.departmentId)
    : rows;

  const summaryMonth = query.summaryMonth || businessMonth();
  const [periodAgg, monthAgg] = await Promise.all([
    aggregatesByUser(periodOf(query.period || "today")),
    aggregatesByUser(monthRange(summaryMonth)),
  ]);

  // Mốc của ĐÚNG phòng từng người. Trước đây luôn truyền null nên bảng danh sách
  // chấm mọi người theo mốc công ty, còn trang chi tiết chấm theo mốc phòng —
  // cùng một người ra hai kết luận Đạt / Chưa đạt trái ngược.
  const targets = await targetsFor(summaryMonth, byDepartment.map((r) => r.user.departmentId));

  const toScore = (r: (typeof rows)[number], agg: Map<string, Aggregates>): PersonScore => {
    const a = agg.get(r.user.id) ?? EMPTY;
    return {
      id: r.user.id,
      fullName: r.user.fullName,
      staffCode: r.user.staffCode,
      departmentName: r.departmentName ?? "",
      bankingPoints: Math.round(a.bankingPoints),
      servicePoints: Math.round(a.servicePoints),
      accounts: a.accounts,
      apps: a.apps,
      insuranceOrders: a.insuranceOrders,
      target: targets.get(r.user.departmentId) ?? 100,
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

/**
 * Hồ sơ điểm của MỘT người.
 *
 * `actor` là bắt buộc: trước đây hàm này không nhận người gọi nên endpoint chi
 * tiết không kiểm gì — ai đăng nhập rồi gõ thẳng id của người khác là đọc được
 * hết. Ngoài tầm nhìn trả `null` (route đổi thành 404) chứ không phải 403, để
 * endpoint không thành chỗ dò id có thật.
 */
export async function personFor(
  actor: User,
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
  if (!inVisibleScope(actor, "staff", "view-detail", row.user.departmentId)) return null;

  const summaryMonth = query.summaryMonth || businessMonth();
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

  /* Quà: đợt CHÍNH NGƯỜI NÀY tặng, trong kỳ đang xem. Lọc theo `granted_by` và
     `granted_at` là bắt buộc — `gift_grants.customer_id` là unique nên mỗi khách
     đúng một đợt, thiếu hai điều kiện này thì quà người khác tặng ở tháng khác
     vẫn hiện lên hồ sơ này. */
  const grants = await db
    .select({ grant: giftGrants, customerName: customers.fullName })
    .from(giftGrants)
    .innerJoin(customers, eq(customers.id, giftGrants.customerId))
    .where(
      and(
        eq(giftGrants.grantedBy, id),
        gte(giftGrants.grantedAt, new Date(`${range.from}T00:00:00+07:00`)),
        lte(giftGrants.grantedAt, new Date(`${range.to}T23:59:59.999+07:00`)),
      ),
    )
    .limit(500);

  /* Điểm tháng (phần tóm tắt) + 5 tháng gần nhất. */
  const monthAgg = (await aggregatesByUser(month)).get(id) ?? EMPTY;
  const target = await targetFor(summaryMonth, row.user.departmentId);

  const [y, m] = summaryMonth.split("-").map(Number);
  const months = Array.from({ length: 5 }, (_, i) =>
    new Date(Date.UTC(y, m - 5 + i, 1)).toISOString().slice(0, 7),
  );
  // MỘT câu mỗi bảng cho cả dải 5 tháng. Vòng lặp cũ gọi `aggregatesByUser` mỗi
  // tháng, mà hàm đó quét TOÀN BỘ người dùng — 15 lượt quét bảng để lấy 5 con số.
  const trend = await monthlyPointsFor(id, monthRange(months[0]).from, monthRange(months[4]).to);
  const monthlyPoints = months.map((ym) => ({ month: ym, points: trend.get(ym) ?? 0 }));

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
    staffCode: row.user.staffCode,
    phone: row.user.phone,
    departmentName: row.departmentName ?? "",
    joinedMonth: businessMonth(row.user.createdAt),
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

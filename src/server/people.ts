import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { PeopleData, PersonScore } from "@/lib/api/people";
import type { PersonDetail } from "@/lib/api/person";
import { businessDay, businessMonth, matchesSearch, monthRange } from "@/lib/format";
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
  kpiScores,
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
 *
 * ⚠️ CÔNG THỨC NGÂN HÀNG Ở ĐÂY LÀ BẢN TẠM, KHÔNG PHẢI LUẬT HIỆN HÀNH.
 *
 * Thể lệ 03/08 đã BỎ cách cộng hệ số từng app: điểm giờ thuộc về cả COMBO của
 * một khách và phụ thuộc tổ hợp hạng ngân hàng (mgst-platform-spec.md §7.1 —
 * "Công thức cũ (bỏ)"), nên `banks.coefficient` hết tác dụng. Thang mới nhỏ
 * hơn thang cũ khoảng 2,5 lần, tức mốc 100 điểm/tháng cũng phải đặt lại — số
 * đọc ra từ màn hình này hiện KHÔNG phải con số nghiệp vụ công nhận.
 *
 * Luật thật phải nằm ở `src/rules/YYYY-MM.ts` (spec §5.3) và còn kẹt ở 12 câu
 * hỏi chưa chốt trong `mgst-the-le/2026-08.md` §7 — trong đó có câu hạng của
 * VPa/VPb, mà danh mục đang seed ngược với thể lệ. Đừng nới công thức này
 * thêm; viết module luật khi 12 câu đó có trả lời.
 */

const PRODUCT_LABEL = { motorbike: "BH xe máy", "electric-accident": "BH tai nạn điện" } as const;

type Period = { from: string; to: string };

/** `YYYY-MM` hợp lệ. Chuỗi bậy đi thẳng vào SQL thành `garbage-01` và vỡ 500. */
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isYearMonth = (v: string): boolean => YEAR_MONTH.test(v);

/** `period` chỉ nhận `today` hoặc `YYYY-MM` — dùng ở route để trả 400 thay vì 500. */
export const isPeriod = (v: string): boolean => v === "today" || isYearMonth(v);

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

/**
 * Hai câu GROUP BY cho MỌI người một lượt — không truy vấn từng người (§11.1).
 *
 * Chỉ ĐẾM, không cộng điểm: điểm đọc từ `kpi_scores` (xem `storedPointsFor`).
 */
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
  }

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
 * Điểm đã tính của mọi người trong một tháng, đọc thẳng từ `kpi_scores`.
 *
 * Không cộng tại chỗ nữa: công thức từ 03/08 tính theo COMBO của từng khách,
 * không phép cộng nào của SQL làm được. `recomputeKpi` (`server/kpi.ts`) ghi
 * vào bảng này mỗi khi dữ liệu nghiệp vụ đổi.
 *
 * Điểm chỉ có nghĩa theo THÁNG: chỉ tiêu là mốc tháng, nên "điểm hôm nay so với
 * mốc tháng" là phép so vô nghĩa — chính giao diện cũng ẩn cột chỉ tiêu khi xem
 * theo ngày. Vì vậy mọi nơi lấy điểm của `summaryMonth`, kể cả lúc bảng đang
 * xem kỳ "hôm nay"; chỉ các cột ĐẾM mới đổi theo kỳ.
 */
async function storedPointsFor(yearMonth: string): Promise<Map<string, Aggregates>> {
  const rows = await db
    .select({
      userId: kpiScores.userId,
      banking: kpiScores.bankingPoints,
      service: kpiScores.servicePoints,
    })
    .from(kpiScores)
    .where(eq(kpiScores.yearMonth, yearMonth));

  return new Map(
    rows.map((r) => [
      r.userId,
      { ...EMPTY, bankingPoints: Number(r.banking), servicePoints: Number(r.service) },
    ]),
  );
}

/**
 * Điểm từng tháng của MỘT người trong cả dải, đọc từ `kpi_scores`.
 *
 * Trước đây cộng bằng hai câu GROUP BY theo tháng trên dữ liệu thô. Không dùng
 * được nữa: công thức tính theo combo của từng khách, `SUM` không diễn tả nổi.
 * Mà đọc bảng thì cũng đúng hơn — biểu đồ 5 tháng và con số headline giờ cùng
 * một nguồn, không thể lệch nhau.
 */
async function monthlyPointsFor(
  userId: string,
  fromMonth: string,
  toMonth: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      yearMonth: kpiScores.yearMonth,
      banking: kpiScores.bankingPoints,
      service: kpiScores.servicePoints,
    })
    .from(kpiScores)
    .where(
      and(
        eq(kpiScores.userId, userId),
        gte(kpiScores.yearMonth, fromMonth),
        lte(kpiScores.yearMonth, toMonth),
      ),
    );

  return new Map(
    rows.map((r) => [r.yearMonth, Math.round(Number(r.banking)) + Math.round(Number(r.service))]),
  );
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
          // Chỉ người đang làm mới có chỉ tiêu. Tính cả tài khoản đã khoá thì
          // họ vào bảng với 0 điểm, `chưa đạt` phồng lên và điểm trung bình tụt
          // — số trên thẻ tóm tắt sai mà không ai thấy vì sao.
          .where(
            visible === null
              ? eq(users.active, true)
              : and(eq(users.active, true), inArray(users.departmentId, visible)),
          )
          .orderBy(asc(users.fullName))
          .limit(500);

  const byDepartment = query.departmentId
    ? rows.filter((r) => r.user.departmentId === query.departmentId)
    : rows;

  const summaryMonth = query.summaryMonth || businessMonth();
  const [periodAgg, points] = await Promise.all([
    aggregatesByUser(periodOf(query.period || "today")),
    storedPointsFor(summaryMonth),
  ]);

  // Mốc của ĐÚNG phòng từng người. Trước đây luôn truyền null nên bảng danh sách
  // chấm mọi người theo mốc công ty, còn trang chi tiết chấm theo mốc phòng —
  // cùng một người ra hai kết luận Đạt / Chưa đạt trái ngược.
  const targets = await targetsFor(summaryMonth, byDepartment.map((r) => r.user.departmentId));

  const toScore = (r: (typeof rows)[number], counts: Map<string, Aggregates>): PersonScore => {
    const a = counts.get(r.user.id) ?? EMPTY;
    const p = points.get(r.user.id) ?? EMPTY;
    return {
      id: r.user.id,
      fullName: r.user.fullName,
      staffCode: r.user.staffCode,
      departmentName: r.departmentName ?? "",
      bankingPoints: Math.round(p.bankingPoints),
      servicePoints: Math.round(p.servicePoints),
      accounts: a.accounts,
      apps: a.apps,
      insuranceOrders: a.insuranceOrders,
      target: targets.get(r.user.departmentId) ?? 100,
    };
  };

  // Điểm đã luôn của `summaryMonth`, nên bản này chỉ khác `people` ở chỗ không
  // lọc theo ô tìm kiếm — bốn thẻ tóm tắt phải đếm trên cả phạm vi.
  const monthScores = byDepartment.map((r) => toScore(r, periodAgg));
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
  // Hồ sơ một người chỉ cần ĐIỂM của tháng — số đếm ở đây lấy từ các danh sách
  // chi tiết bên dưới, không qua `aggregatesByUser`.
  const monthAgg = (await storedPointsFor(summaryMonth)).get(id) ?? EMPTY;
  const target = await targetFor(summaryMonth, row.user.departmentId);

  const [y, m] = summaryMonth.split("-").map(Number);
  const months = Array.from({ length: 5 }, (_, i) =>
    new Date(Date.UTC(y, m - 5 + i, 1)).toISOString().slice(0, 7),
  );
  // MỘT câu mỗi bảng cho cả dải 5 tháng. Vòng lặp cũ gọi `aggregatesByUser` mỗi
  // tháng, mà hàm đó quét TOÀN BỘ người dùng — 15 lượt quét bảng để lấy 5 con số.
  const trend = await monthlyPointsFor(id, months[0], months[4]);
  const monthlyPoints = months.map((ym) => ({ month: ym, points: trend.get(ym) ?? 0 }));

  /**
   * Gộp theo NGUỒN, không phải mỗi bản ghi một dòng.
   *
   * Một người mở 40 tài khoản VPa thì cách cũ trả 40 mục cùng nhãn "VPa":
   * `ProgressRing` vẽ 40 cung trùng `key` (React cảnh báo và ghép nhầm khi đổi
   * kỳ), còn bảng chú thích dài 40 dòng thay vì một dòng mỗi ngân hàng.
   *
   * TODO(KPI, chờ `src/rules/YYYY-MM.ts`): CHỈ CÓ NGUỒN DỊCH VỤ.
   *
   * Vòng điểm lấy tổng bằng cách cộng các cung (`ProgressRing` tự reduce), nên
   * nguồn ở đây phải cộng ra ĐÚNG `points.total` bên cạnh — lệch là hai con số
   * mâu thuẫn trên cùng một thẻ. Điểm ngân hàng giờ do module luật trả về một
   * cục, và luật mới quy điểm cho CẢ COMBO của một khách chứ không cho từng
   * ngân hàng, nên "mỗi ngân hàng một cung" không còn là cách chia đúng.
   *
   * Khi viết file luật, nó phải trả kèm phần chia theo khách; lúc đó thêm các
   * cung đó vào đây. Trước đó để trống còn hơn chia bằng hệ số đã bị bỏ.
   */
  const bySource = new Map<string, { label: string; count: number; points: number }>();
  const addSource = (label: string, points: number) => {
    const kept = bySource.get(label) ?? { label, count: 0, points: 0 };
    kept.count += 1;
    kept.points += points;
    bySource.set(label, kept);
  };

  for (const r of serviceRows) addSource(r.typeName, Number(r.coefficient));

  // Làm tròn 2 số: hệ số là `numeric(4,2)` nên cộng dồn ra 4.199999999999999.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const pointSources = [...bySource.values()]
    .map((s) => ({
      label: s.label,
      detail: `${s.count} lượt · hệ số ${round2(s.points / s.count)}`,
      points: round2(s.points),
    }))
    .sort((a, b) => b.points - a.points);

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
      // Cộng hai số ĐÃ làm tròn, không làm tròn tổng thô: P-51 lấy tổng bằng
      // `bankingPoints + servicePoints` từ hai số đã tròn, nên làm tròn tổng ở
      // đây cho ra con số khác — 1.4 + 1.4 thành 2 ở danh sách mà 3 ở hồ sơ,
      // và "đạt / chưa đạt" lật ngay chỗ giáp mốc.
      total: Math.round(monthAgg.bankingPoints) + Math.round(monthAgg.servicePoints),
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

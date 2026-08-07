import { and, asc, eq, gte, inArray, lte, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { PersonScore } from "@/lib/api/people";
import type { PersonDetail } from "@/lib/api/person";
import { BUSINESS_TIMEZONE, businessDay, businessMonth, monthRange } from "@/lib/format";
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

type Period = { from: string; to: string };

/** `YYYY-MM` hợp lệ. Chuỗi bậy đi thẳng vào SQL thành `garbage-01` và vỡ 500. */
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isYearMonth = (v: string): boolean => YEAR_MONTH.test(v);

/** Khoảng ngày tự chọn, dạng `range:YYYY-MM-DD:YYYY-MM-DD` — bộ chọn kỳ của P-80. */
const PICKED_RANGE = /^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;

/**
 * `period` nhận `today`, `YYYY-MM`, hoặc `range:từ:đến` — dùng ở route để trả
 * 400 thay vì 500.
 *
 * ⚠️ Chuỗi lạ đi qua được chốt này sẽ tới `monthRange`, và nó dựng ra
 * `this-month-01` / `this-month-NaN` rồi Postgres đổ lỗi cast ngày. Đã dính
 * thật: màn Tổng quan gửi `this-month` (từ vựng của `PeriodPicker`) sang đây,
 * nơi chỉ hiểu `YYYY-MM`, và endpoint trả 500 cho mọi nhân viên.
 */
export const isPeriod = (v: string): boolean =>
  v === "today" || isYearMonth(v) || PICKED_RANGE.test(v);

const todayIso = (): string => businessDay();

const periodOf = (period: string): Period => {
  if (period === "today") return { from: todayIso(), to: todayIso() };
  const picked = period.match(PICKED_RANGE);
  if (picked) return { from: picked[1], to: picked[2] };
  return monthRange(period);
};

/**
 * NGÀY CỦA ĐƠN bảo hiểm là `created_at`, KHÔNG phải `start_date`.
 *
 * `start_date` là ngày hợp đồng có hiệu lực — người nhập chọn, lùi hay tiến đều
 * được, và một đơn lập hôm nay cho hợp đồng hiệu lực tháng sau là chuyện bình
 * thường. Lấy nó làm ngày của đơn thì công của tháng này rơi sang tháng sau, và
 * ngược lại (chốt 07/08).
 *
 * Cột là `timestamptz` nên phải quy về ngày làm việc giờ Việt Nam trước khi so:
 * đơn lập lúc 0–7h sáng mà so thẳng theo UTC sẽ rơi về hôm trước.
 */
const orderedInRange = (range: Period): SQL =>
  sql`(${insuranceOrders.createdAt} at time zone ${BUSINESS_TIMEZONE})::date between ${range.from}::date and ${range.to}::date`;

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

/* ── Mảnh SQL dùng chung với `server/staff.ts` ───────────────────────────
 *
 * Bảng nhân sự cho LỌC và SẮP theo chỉ tiêu, nên điểm và mốc phải tính được
 * ngay trong `ORDER BY` và `WHERE`. Tính ở JS thì máy chủ cắt trang mù.
 */

/**
 * Điểm tháng, làm tròn TỪNG vế rồi mới cộng.
 *
 * Không làm tròn tổng thô: giao diện lấy tổng bằng `bankingPoints + servicePoints`
 * từ hai số đã tròn, nên tròn ở tổng cho ra con số khác và "đạt / chưa đạt" lật
 * ngay chỗ giáp mốc.
 */
export const bankingExpr = sql<number>`round(coalesce(${kpiScores.bankingPoints}, 0))::int`;
export const serviceExpr = sql<number>`round(coalesce(${kpiScores.servicePoints}, 0))::int`;
export const pointsExpr = sql<number>`(${bankingExpr} + ${serviceExpr})`;

/**
 * Chỉ tiêu của ĐÚNG phòng người này, viết thẳng trong SQL.
 *
 * Cùng chuỗi rơi với `targetsFor`, chỉ khác là chạy trong database. Người không
 * thuộc phòng nào (ban giám đốc) có `department_id` null nên vế đầu không khớp
 * dòng nào và rơi thẳng xuống mốc chung — đúng như bản JS.
 */
export const targetExpr = (yearMonth: string) => sql<number>`coalesce(
  (select t.monthly_points from ${kpiTargets} t
    where t.year_month = ${yearMonth} and t.department_id = ${users.departmentId}),
  (select t.monthly_points from ${kpiTargets} t
    where t.department_id is null and t.year_month <= ${yearMonth}
    order by t.year_month desc limit 1),
  100
)`;

/** Vô hiệu ký tự đại diện của `LIKE` — gõ `%` phải ra "không có kết quả". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Tìm theo tên nhân viên, tên đăng nhập hoặc tên đơn vị — không dấu cũng khớp,
 * không phụ thuộc thứ tự từ. Cùng luật với `matchesSearch` ở giao diện.
 *
 * Câu gọi PHẢI có `leftJoin(departments)`, vì mỗi từ soi cả tên phòng.
 */
export function staffSearchWhere(search: string): SQL | undefined {
  const text = search.trim();
  if (!text) return undefined;

  const like = (col: SQL | AnyColumn, term: string) =>
    sql`mgst_normalize(${col}) like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'`;

  return and(
    ...text
      .split(/\s+/)
      .map((term) =>
        sql`(${like(users.fullName, term)} or ${like(users.username, term)} or ${like(sql`coalesce(${departments.name}, '')`, term)})`,
      ),
  );
}

type Aggregates = {
  accounts: number;
  apps: number;
  bankingPoints: number;
  servicePoints: number;
  insuranceOrders: number;
};

type Counts = { accounts: number; apps: number; insuranceOrders: number };

const NO_COUNTS: Counts = { accounts: 0, apps: 0, insuranceOrders: 0 };

/**
 * Số đếm theo kỳ, chỉ cho những người ĐƯỢC HỎI TỚI.
 *
 * `inArray` chứ không gộp cả kho: chỉ mục `bank_accounts_creator_date`
 * (created_by, opened_date) và `insurance_orders_creator_date` đỡ trọn phép này.
 * Hai câu GROUP BY cho cả danh sách, không truy vấn từng người (§11.1).
 */
async function countsFor(userIds: string[], range: Period): Promise<Map<string, Counts>> {
  const map = new Map<string, Counts>();
  if (userIds.length === 0) return map;

  const entry = (id: string | null): Counts => {
    const key = id ?? "";
    let c = map.get(key);
    if (!c) {
      c = { ...NO_COUNTS };
      map.set(key, c);
    }
    return c;
  };

  const [bankRows, orderRows] = await Promise.all([
    db
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
          inArray(bankAccounts.createdBy, userIds),
          eq(bankAccounts.status, "done"),
          gte(bankAccounts.openedDate, range.from),
          lte(bankAccounts.openedDate, range.to),
        ),
      )
      .groupBy(bankAccounts.createdBy),
    db
      .select({ createdBy: insuranceOrders.createdBy, n: sql<number>`count(*)::int` })
      .from(insuranceOrders)
      .where(
        and(
          inArray(insuranceOrders.createdBy, userIds),
          orderedInRange(range),
        ),
      )
      .groupBy(insuranceOrders.createdBy),
  ]);

  for (const r of bankRows) {
    const c = entry(r.createdBy);
    c.accounts = r.accounts;
    c.apps = r.apps;
  }
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

export const daysLeftOf = (yearMonth: string): number => {
  const today = businessDay();
  if (yearMonth !== today.slice(0, 7)) return 0;
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - d;
};

/**
 * TRỌN danh sách nhân viên kèm điểm và SỐ ĐẾM theo kỳ, cho việc xuất Excel.
 *
 * Ba cột đếm (`accounts`, `apps`, `insuranceOrders`) chỉ còn sống ở đây. Màn
 * P-51 đã bỏ chúng khỏi bảng, nên gộp trên kho tài khoản giờ chỉ xảy ra khi ai
 * đó bấm xuất Excel, không phải mỗi lần gõ phím.
 *
 * KHÔNG có trần số dòng, khác `listCustomersForExport`. Trần bên đó có lý vì
 * bảng khách hàng lớn thêm mỗi ngày làm việc; bảng này thì số dòng bằng số
 * nhân viên công ty, chặn ở 20.000 là chặn một tình huống không tồn tại — mà
 * cái giá của nó là nơi gọi phải nhớ so `rows.length` với `total`, một nghĩa vụ
 * dễ quên và im lặng khi quên.
 *
 * Đây là route riêng chứ không phải tham số "lấy hết" trên route đã phân trang
 * (AGENTS.md §5.1, điều 4).
 */
export async function peopleForExport(
  actor: User,
  query: { scope: string; period: string; summaryMonth: string; departmentId: string; search: string },
): Promise<PersonScore[]> {
  // Kẹp theo ĐÚNG hành động mà route gác — `export`, không phải `view-detail`.
  // Lệch hai vế là ai có `view-detail` toàn công ty nhưng `export` một phòng
  // vẫn tải được cả công ty bằng cách tự sửa `?scope=`.
  const requested = Scope.safeParse(query.scope);
  const scope = clampScope(actor, "staff", "export", requested.success ? requested.data : null);
  const visible = visibleDepartmentIds(actor, scope);
  if (visible !== null && visible.length === 0) return [];

  const summaryMonth = query.summaryMonth || businessMonth();

  // Chỉ người đang làm mới có chỉ tiêu. Tính cả tài khoản đã khoá thì họ vào
  // bảng với 0 điểm và cột "chưa đạt" phồng lên mà không ai thấy vì sao.
  const where = and(
    eq(users.active, true),
    visible === null ? undefined : inArray(users.departmentId, visible),
    query.departmentId ? eq(users.departmentId, query.departmentId) : undefined,
    staffSearchWhere(query.search),
  );

  // leftJoin, KHÔNG innerJoin: `users.department_id` để trống với ban giám đốc,
  // innerJoin thì họ rơi khỏi bản xuất mà không báo gì.
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      staffCode: users.staffCode,
      departmentName: departments.name,
      bankingPoints: bankingExpr,
      servicePoints: serviceExpr,
      target: targetExpr(summaryMonth),
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .leftJoin(
      kpiScores,
      and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, summaryMonth)),
    )
    .where(where)
    .orderBy(asc(sql`mgst_normalize(${users.fullName})`), asc(users.id));

  const counts = await countsFor(
    rows.map((r) => r.id),
    periodOf(query.period || "today"),
  );

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    staffCode: r.staffCode,
    departmentName: r.departmentName ?? "",
    bankingPoints: r.bankingPoints,
    servicePoints: r.servicePoints,
    ...(counts.get(r.id) ?? NO_COUNTS),
    target: r.target,
  }));
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
        orderedInRange(range),
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
  // Hồ sơ một người chỉ cần ĐIỂM của tháng — số đếm ở đây lấy từ chính các danh
  // sách chi tiết bên dưới, không đi qua phép gộp nào.
  const monthAgg = (await storedPointsFor(summaryMonth)).get(id) ?? EMPTY;
  const target = await targetFor(summaryMonth, row.user.departmentId);

  const [y, m] = summaryMonth.split("-").map(Number);
  const months = Array.from({ length: 5 }, (_, i) =>
    new Date(Date.UTC(y, m - 5 + i, 1)).toISOString().slice(0, 7),
  );
  // MỘT câu cho cả dải 5 tháng. Vòng lặp cũ gộp lại theo từng tháng trên TOÀN BỘ
  // người dùng — 15 lượt quét bảng chỉ để lấy 5 con số của một người.
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
      // Ngày ĐƠN, khớp với phép đếm ở `orderedInRange`.
      date: businessDay(r.order.createdAt),
      customerName: r.customerName,
      product: r.order.product,
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

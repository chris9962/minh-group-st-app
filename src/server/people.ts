import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { PersonScore } from "@/lib/api/people";
import type {
  PersonAccount,
  PersonCustomer,
  PersonDetail,
  PersonInsurance,
  PersonService,
} from "@/lib/api/person";
import type { Page } from "@/lib/api/pagination";
import { BUSINESS_TIMEZONE, businessDay, businessMonth, monthRange, roundPoints } from "@/lib/format";
import { clampScope, inVisibleScope, visibleDepartmentIds } from "@/lib/permissions";
import { DepartmentType, ROLE_RANK, Scope, type User } from "@/lib/types";
import { db } from "./db/client";
import type { PageArgs } from "./pagination";
import {
  bankAccounts,
  banks,
  channels,
  customerPhones,
  customers,
  departments,
  insuranceOrders,
  kpiAdjustments,
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
 * NGÀY CỦA ĐƠN bảo hiểm là `order_date`, KHÔNG phải `start_date`.
 *
 * `start_date` là ngày hợp đồng có hiệu lực — người nhập chọn, lùi hay tiến đều
 * được, và một đơn lập hôm nay cho hợp đồng hiệu lực tháng sau là chuyện bình
 * thường. Lấy nó làm ngày của đơn thì công của tháng này rơi sang tháng sau, và
 * ngược lại (chốt 07/08).
 */
const orderedInRange = (range: Period): SQL =>
  and(
    gte(insuranceOrders.orderDate, range.from),
    lte(insuranceOrders.orderDate, range.to),
  ) as SQL;

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
 * Điểm tháng, GIỮ HAI SỐ LẺ.
 *
 * Trước đây làm tròn về số nguyên. Không dùng được nữa: thang điểm từ kỳ
 * 2026-08 chạy 0,4 đến 1,2 cho mỗi khách, nên `round(...)::int` biến 1,2 thành
 * 1 và 0,4 thành 0 — cả công ty về gần hết 0 điểm ngân hàng.
 *
 * Hai cột nguồn đã là `numeric(10,2)` nên cộng trong SQL không sinh sai số; ép
 * `float` một lần ở ngoài cùng để `pointsExpr` vẫn nằm được trong `ORDER BY` và
 * `WHERE` của bảng nhân sự.
 */
export const bankingExpr = sql<number>`coalesce(${kpiScores.bankingPoints}, 0)::float`;
export const serviceExpr = sql<number>`coalesce(${kpiScores.servicePoints}, 0)::float`;

/**
 * Tổng điểm cộng tay của tháng — truy vấn con tương quan theo dòng `users`.
 *
 * Không đi qua `kpi_scores`: `recomputeKpiOn` xoá dòng bảng đó khi người thuộc
 * phòng `office`, điểm cộng tay nằm chung là mất theo lượt tính lại. Truy vấn
 * con thay vì join để `staffFor` không phải chêm join vào cả ba câu đang dùng
 * — `kpi_adjustments` là bảng gõ tay vài dòng mỗi tháng, không phải hình dạng
 * câu hỏi mà §5.2 cấm.
 */
export const adjustmentExpr = (yearMonth: string) =>
  sql<number>`coalesce((select sum(a.points) from ${kpiAdjustments} a
    where a.user_id = ${users.id} and a.year_month = ${yearMonth}), 0)::float`;

/** Điểm tháng = ngân hàng + dịch vụ + điểm cộng tay. Nhận tháng vì vế thứ ba
    nằm ngoài `kpi_scores` — bản hằng số cũ không nói được "tháng nào". */
export const pointsExpr = (yearMonth: string) =>
  sql<number>`(coalesce(${kpiScores.bankingPoints}, 0) + coalesce(${kpiScores.servicePoints}, 0) + ${adjustmentExpr(yearMonth)})::float`;

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

/**
 * Bậc chức vụ viết trong SQL — bản `ROLE_RANK` của `lib/types.ts`, sinh từ
 * chính hằng số đó nên thêm một vai mới là hai vế đi cùng nhau.
 *
 * Sắp bằng chính cột `role` thì Postgres đi theo thứ tự khai enum, mà enum khai
 * `director` trước `staff`. Giám đốc vì thế mang số nhỏ nhất, và `DESC` đẩy
 * Nhân viên lên đầu — mũi tên trên tiêu đề cột nói ngược với thứ tự thấy được.
 */
export const roleRankExpr: SQL = sql`case ${users.role}
${sql.join(
  Object.entries(ROLE_RANK).map(([role, rank]) => sql`when ${role} then ${rank}`),
  sql` `,
)}
else 0 end`;

/**
 * Người đã có tài khoản tính tới hết tháng `yearMonth`.
 *
 * Bảng nhân sự đổi tháng là đổi cột Chỉ tiêu, nên danh sách người phải đổi
 * theo. Không có điều kiện này thì người lập tài khoản 2026-08 vẫn nằm trong
 * bảng của 2026-07 với 0 điểm, và thẻ "chưa đạt" đếm cả người chưa vào công ty.
 *
 * Mốc là `created_at` — chốt 2026-08-14, KHÔNG thêm cột ngày vào làm. Hai thứ
 * này khác nhau: người vào từ tháng 5 mà tài khoản lập tháng 8 thì tháng 5 đến
 * tháng 7 không thấy họ trong bảng.
 *
 * ⚠️ Ép `::timestamp` TRƯỚC `at time zone`, và đây là chỗ đã sai một lần ở
 * `server/audit.ts` — xem ghi chú dài tại đó.
 */
export const createdByEndOf = (yearMonth: string): SQL =>
  sql`${users.createdAt} < ((${monthRange(yearMonth).to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`;

export type StaffCounts = { customers: number; accounts: number; services: number };
const NO_STAFF_COUNTS: StaffCounts = { customers: 0, accounts: 0, services: 0 };

/**
 * Ba số đếm của một KHOẢNG NGÀY cho một NHÓM NGƯỜI CỤ THỂ, gộp theo người tạo.
 *
 * ⚠️ `userIds` phải là id của ĐÚNG trang đang hiện, không phải cả công ty. Đây
 * là bước "dán phần phụ sau" của cách A ở AGENTS.md §5.2: cắt trang trước bằng
 * câu chính, rồi đếm cho 15 dòng đó. Truyền cả bảng vào đây là quay lại đúng
 * hình dạng câu hỏi mà §5.2 cấm.
 *
 * Vì thế ba số này KHÔNG sắp được. Muốn sắp thì phải chuyển sang cột đếm do
 * trigger giữ — cách B của §5.2, kèm đủ 5 điều kiện của db-design §9.
 *
 * Ba mốc ngày khác nhau, cố ý:
 *   khách hàng  `created_at`   timestamptz, phải quy về giờ làm việc
 *   tài khoản   `opened_date`  ngày mở, và chỉ đếm bản `done`
 *   dịch vụ     `service_date` ngày làm dịch vụ
 *
 * Bản `creating` không phải tài khoản thật, cùng lối lọc với `scoringAccountsOf`.
 */
export async function countsInRange(
  userIds: string[],
  { from, to }: { from: string; to: string },
): Promise<Map<string, StaffCounts>> {
  const map = new Map<string, StaffCounts>();
  if (userIds.length === 0) return map;

  const entry = (id: string | null): StaffCounts => {
    const key = id ?? "";
    let c = map.get(key);
    if (!c) {
      c = { ...NO_STAFF_COUNTS };
      map.set(key, c);
    }
    return c;
  };

  const [customerRows, accountRows, serviceRows] = await Promise.all([
    db
      .select({ createdBy: customers.createdBy, n: sql<number>`count(*)::int` })
      .from(customers)
      .where(
        and(
          inArray(customers.createdBy, userIds),
          // Cột là `timestamptz`, hai mốc phải quy về giờ làm việc — cùng cách
          // với `createdByEndOf` ngay bên trên.
          sql`${customers.createdAt} >= ((${from}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
          sql`${customers.createdAt} < ((${to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
        ),
      )
      .groupBy(customers.createdBy),
    db
      .select({ createdBy: bankAccounts.createdBy, n: sql<number>`count(*)::int` })
      .from(bankAccounts)
      .where(
        and(
          inArray(bankAccounts.createdBy, userIds),
          eq(bankAccounts.status, "done"),
          gte(bankAccounts.openedDate, from),
          lte(bankAccounts.openedDate, to),
        ),
      )
      .groupBy(bankAccounts.createdBy),
    db
      .select({ createdBy: services.createdBy, n: sql<number>`count(*)::int` })
      .from(services)
      .where(
        and(
          inArray(services.createdBy, userIds),
          gte(services.serviceDate, from),
          lte(services.serviceDate, to),
        ),
      )
      .groupBy(services.createdBy),
  ]);

  for (const r of customerRows) entry(r.createdBy).customers = Number(r.n);
  for (const r of accountRows) entry(r.createdBy).accounts = Number(r.n);
  for (const r of serviceRows) entry(r.createdBy).services = Number(r.n);
  return map;
}

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
  const [rows, adjustmentRows] = await Promise.all([
    db
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
      ),
    // Điểm cộng tay nằm ngoài `kpi_scores` — thiếu vế này thì cột của biểu đồ
    // 5 tháng lệch với con số headline ngay bên cạnh.
    db
      .select({
        yearMonth: kpiAdjustments.yearMonth,
        points: sql<number>`sum(${kpiAdjustments.points})::float`,
      })
      .from(kpiAdjustments)
      .where(
        and(
          eq(kpiAdjustments.userId, userId),
          gte(kpiAdjustments.yearMonth, fromMonth),
          lte(kpiAdjustments.yearMonth, toMonth),
        ),
      )
      .groupBy(kpiAdjustments.yearMonth),
  ]);

  const byMonth = new Map(
    rows.map((r) => [r.yearMonth, Number(r.banking) + Number(r.service)]),
  );
  for (const r of adjustmentRows)
    byMonth.set(r.yearMonth, (byMonth.get(r.yearMonth) ?? 0) + Number(r.points));

  return new Map([...byMonth].map(([ym, points]) => [ym, roundPoints(points)]));
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
 * `apps` và `insuranceOrders` chỉ còn sống ở đây — bảng P-51 không có hai cột
 * đó. `accounts` thì bảng có lại từ 2026-08-14, nhưng đi qua `countsInRange`,
 * tức chỉ đếm cho 15 id của trang; `countsFor` dưới đây đếm cho TRỌN danh sách
 * nhân viên nên nặng hơn hẳn, và đó là lý do nó ở lại đường xuất Excel.
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
  query: {
    scope: string;
    period: string;
    summaryMonth: string;
    departmentId: string;
    /** `sales` · `office` · rỗng là mọi loại. Lọc theo LOẠI phòng, độc lập với `departmentId`. */
    departmentType: string;
    search: string;
  },
): Promise<PersonScore[]> {
  // Kẹp theo ĐÚNG hành động mà route gác — `export`, không phải `view-detail`.
  // Lệch hai vế là ai có `view-detail` toàn công ty nhưng `export` một phòng
  // vẫn tải được cả công ty bằng cách tự sửa `?scope=`.
  const requested = Scope.safeParse(query.scope);
  const scope = clampScope(actor, "staff", "export", requested.success ? requested.data : null);
  const visible = visibleDepartmentIds(actor, scope);
  if (visible !== null && visible.length === 0) return [];

  const summaryMonth = query.summaryMonth || businessMonth();

  const departmentType = DepartmentType.safeParse(query.departmentType);

  // Chỉ người đang làm mới có chỉ tiêu. Tính cả tài khoản đã khoá thì họ vào
  // bảng với 0 điểm và cột "chưa đạt" phồng lên mà không ai thấy vì sao.
  const where = and(
    eq(users.active, true),
    /**
     * Bỏ người KHÔNG thuộc phòng nào (chốt 2026-08-22): Ban giám đốc và tài
     * khoản quản trị. Đây là bảng thành tích của các phòng, mà họ không có
     * chỉ tiêu — để lại thì mỗi tháng có mấy dòng 0 điểm không ai đọc.
     *
     * Chỉ áp cho bản XUẤT. Màn P-51 vẫn liệt kê họ.
     */
    isNotNull(users.departmentId),
    visible === null ? undefined : inArray(users.departmentId, visible),
    query.departmentId ? eq(users.departmentId, query.departmentId) : undefined,
    departmentType.success ? eq(departments.type, departmentType.data) : undefined,
    // Cùng mốc với màn P-51. Lệch hai vế là bản xuất Excel và bảng trên màn
    // hình cho hai số khác nhau cho cùng một tháng.
    createdByEndOf(summaryMonth),
    staffSearchWhere(query.search),
  );

  // Vẫn leftJoin dù `where` đã chặn `department_id` rỗng: đổi sang innerJoin
  // thì hai vế cùng nói một luật, mà sửa một vế quên vế kia là dòng rơi mất
  // không báo gì. Một chỗ quyết định, ở `where`.
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      staffCode: users.staffCode,
      departmentName: departments.name,
      bankingPoints: bankingExpr,
      servicePoints: serviceExpr,
      adjustmentPoints: adjustmentExpr(summaryMonth),
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
    adjustmentPoints: r.adjustmentPoints,
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

  /* Bốn danh sách hoạt động trong kỳ KHÔNG còn nằm ở đây — mỗi tab một route
     phân trang riêng (`personCustomersFor`…, chốt 2026-08-15). Hàm này chỉ còn
     gộp điểm dịch vụ theo LOẠI cho các cung nguồn điểm, và ba số đếm cho màn
     Tổng quan của nhân viên. */
  const countOf = async (table: typeof bankAccounts | typeof insuranceOrders | typeof services, where: SQL | undefined) => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
    return n;
  };
  const counts = {
    accounts: await countOf(
      bankAccounts,
      and(
        eq(bankAccounts.createdBy, id),
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, range.from),
        lte(bankAccounts.openedDate, range.to),
      ),
    ),
    insurance: await countOf(
      insuranceOrders,
      and(eq(insuranceOrders.createdBy, id), orderedInRange(range)),
    ),
    services: await countOf(
      services,
      and(
        eq(services.createdBy, id),
        gte(services.serviceDate, range.from),
        lte(services.serviceDate, range.to),
      ),
    ),
  };

  /* Các cung nguồn điểm gộp theo THÁNG ĐIỂM, không theo kỳ lọc: khối KPI luôn
     là tháng của `summaryMonth`, còn kỳ lọc chỉ đổi các danh sách hoạt động.
     Gộp theo kỳ là cung dịch vụ của một kỳ đem cộng với cung ngân hàng của cả
     tháng — tổng các cung lệch với `points.total` ngay bên cạnh. */
  const kpiRange = monthRange(summaryMonth);
  const serviceAgg = await db
    .select({
      typeName: serviceTypes.name,
      count: sql<number>`count(*)::int`,
      points: sql<number>`sum(${serviceTypes.coefficient})::float`,
    })
    .from(services)
    .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
    .where(
      and(
        eq(services.createdBy, id),
        gte(services.serviceDate, kpiRange.from),
        lte(services.serviceDate, kpiRange.to),
      ),
    )
    .groupBy(serviceTypes.name);

  /** Từng lần cộng điểm tay của tháng, kèm tên người cộng — bảng ở P-52. */
  const adjustmentRows = await db
    .select({
      id: kpiAdjustments.id,
      points: kpiAdjustments.points,
      reason: kpiAdjustments.reason,
      date: sql<string>`to_char(${kpiAdjustments.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD')`,
      createdByName: users.fullName,
    })
    .from(kpiAdjustments)
    .innerJoin(users, eq(users.id, kpiAdjustments.createdBy))
    .where(and(eq(kpiAdjustments.userId, id), eq(kpiAdjustments.yearMonth, summaryMonth)))
    .orderBy(asc(kpiAdjustments.createdAt), asc(kpiAdjustments.id));
  const adjustments = adjustmentRows.map((r) => ({ ...r, points: Number(r.points) }));
  const adjustmentTotal = adjustments.reduce((sum, r) => sum + r.points, 0);

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
   * Vòng điểm lấy tổng bằng cách cộng các cung (`ProgressRing` tự reduce), nên
   * nguồn ở đây phải cộng ra ĐÚNG `points.total` bên cạnh — lệch là hai con số
   * mâu thuẫn trên cùng một thẻ.
   */
  const pointSources = serviceAgg.map((s) => ({
    label: s.typeName,
    // Làm tròn 2 số: hệ số là `numeric(4,2)` nên cộng dồn ra 4.199999999999999.
    detail: `${s.count} lượt · hệ số ${roundPoints(s.points / s.count)}`,
    points: roundPoints(s.points),
  }));

  /* Điểm ngân hàng về MỘT cung duy nhất. Luật của kỳ quy điểm cho cả combo của
     một khách chứ không cho từng ngân hàng, nên chẻ nhỏ theo ngân hàng là bịa
     ra con số không có trong thể lệ. Nhưng bỏ hẳn thì tổng các cung thiếu mất
     phần ngân hàng và lệch với `points.total` ngay bên cạnh. */
  const bankingTotal = roundPoints(monthAgg.bankingPoints);
  if (bankingTotal > 0)
    pointSources.push({
      label: "Ngân hàng",
      detail: "Điểm combo của khách do người này lập hồ sơ",
      points: bankingTotal,
    });

  /* Điểm cộng tay là một cung — kể cả khi ÂM, vì tổng các cung phải cộng ra
     ĐÚNG `points.total`. Cung âm không vẽ được thì `ProgressRing` tự bỏ nét,
     nhưng vẫn trừ vào con số giữa vòng. */
  if (adjustmentTotal !== 0)
    pointSources.push({
      label: "Điểm cộng",
      detail: `${adjustments.length} lần cộng tay trong tháng`,
      points: roundPoints(adjustmentTotal),
    });

  pointSources.sort((a, b) => b.points - a.points);

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
      banking: roundPoints(monthAgg.bankingPoints),
      service: roundPoints(monthAgg.servicePoints),
      adjustment: roundPoints(adjustmentTotal),
      // Làm tròn ở TỔNG, đúng cách P-51 làm (`totalPoints`). Ba cột nguồn đã
      // là `numeric(10,2)` nên phép cộng chỉ có thể đẻ đuôi rác của số thực,
      // không đẻ chênh lệch thật — hai màn ra cùng một số.
      total: roundPoints(monthAgg.bankingPoints + monthAgg.servicePoints + adjustmentTotal),
      target,
    },
    pointSources,
    adjustments,
    monthlyPoints,
    counts,
  };
}

/**
 * Bốn danh sách hoạt động của MỘT người, mỗi danh sách một route phân trang
 * (chốt 2026-08-15) — thay cho bản cũ trả cả bốn mảng trong `personFor` với
 * trần 500 dòng cắt không báo.
 *
 * Cùng luật tầm nhìn với `personFor`: ngoài tầm trả `null` → route đổi 404.
 * Khoá sắp duy nhất là `date`; luôn kèm `id` làm khoá phụ — thứ tự giữa những
 * dòng cùng ngày phải ổn định qua các trang (xem `listCustomers`).
 */
async function visibleStaffId(actor: User, id: string): Promise<boolean> {
  const rows = await db
    .select({ departmentId: users.departmentId })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!rows[0]) return false;
  return inVisibleScope(actor, "staff", "view-detail", rows[0].departmentId);
}

const orderedBy = (col: AnyColumn, dir: "asc" | "desc", idCol: AnyColumn) =>
  dir === "asc" ? [asc(col), asc(idCol)] : [desc(col), desc(idCol)];

export async function personCustomersFor(
  actor: User,
  id: string,
  range: Period,
  page: PageArgs<"date">,
): Promise<Page<PersonCustomer> | null> {
  if (!(await visibleStaffId(actor, id))) return null;

  /* `created_at` là `timestamptz` nên hai mốc phải quy về giờ làm việc — so
     thẳng thì khách lập lúc 23:30 ngày cuối kỳ rơi sang kỳ sau. */
  const where = and(
    eq(customers.createdBy, id),
    sql`${customers.createdAt} >= ((${range.from}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
    sql`${customers.createdAt} < ((${range.to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
  );

  const rows = await db
    .select({
      id: customers.id,
      date: sql<string>`to_char(${customers.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD')`,
      fullName: customers.fullName,
      phone: sql<string>`coalesce((select cp.number from ${customerPhones} cp
        where cp.customer_id = ${customers.id} order by cp.is_primary desc limit 1), '')`,
      channel: sql<string>`coalesce(${channels.name}, '')`,
      accountCount: customers.accountCount,
      insuranceCount: customers.insuranceCount,
    })
    .from(customers)
    .leftJoin(channels, eq(channels.id, customers.channelId))
    .where(where)
    .orderBy(...orderedBy(customers.createdAt, page.dir, customers.id))
    .limit(page.limit)
    .offset(page.offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(customers)
    .where(where);

  return { rows, total };
}

export async function personAccountsFor(
  actor: User,
  id: string,
  range: Period,
  page: PageArgs<"date">,
): Promise<Page<PersonAccount> | null> {
  if (!(await visibleStaffId(actor, id))) return null;

  const where = and(
    eq(bankAccounts.createdBy, id),
    eq(bankAccounts.status, "done"),
    gte(bankAccounts.openedDate, range.from),
    lte(bankAccounts.openedDate, range.to),
  );

  const rows = await db
    .select({
      account: bankAccounts,
      bankCode: banks.code,
      customerName: customers.fullName,
      referralCode: sql<string>`(select code from referral_codes rc where rc.id = ${bankAccounts.referralCodeId})`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(where)
    .orderBy(...orderedBy(bankAccounts.openedDate, page.dir, bankAccounts.id))
    .limit(page.limit)
    .offset(page.offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(bankAccounts)
    .where(where);

  return {
    rows: rows.map((r) => ({
      id: r.account.id,
      date: r.account.openedDate ?? "",
      customerId: r.account.customerId,
      customerName: r.customerName,
      bankName: r.bankCode,
      referralCode: r.referralCode ?? "",
      channel: r.account.channelDetail,
      appInstalled: r.account.appInstalled,
      accountType: r.account.accountType,
    })),
    total,
  };
}

export async function personInsuranceFor(
  actor: User,
  id: string,
  range: Period,
  page: PageArgs<"date">,
): Promise<Page<PersonInsurance> | null> {
  if (!(await visibleStaffId(actor, id))) return null;

  const where = and(eq(insuranceOrders.createdBy, id), orderedInRange(range));

  const rows = await db
    .select({ order: insuranceOrders, customerName: customers.fullName })
    .from(insuranceOrders)
    .innerJoin(customers, eq(customers.id, insuranceOrders.customerId))
    .where(where)
    .orderBy(...orderedBy(insuranceOrders.orderDate, page.dir, insuranceOrders.id))
    .limit(page.limit)
    .offset(page.offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(insuranceOrders)
    .where(where);

  return {
    rows: rows.map((r) => ({
      id: r.order.id,
      // Ngày ĐƠN, khớp với phép đếm ở `orderedInRange`.
      date: r.order.orderDate,
      customerId: r.order.customerId,
      customerName: r.customerName,
      product: r.order.product,
      packageName: r.order.packageName,
      status: r.order.status,
    })),
    total,
  };
}

export async function personServicesFor(
  actor: User,
  id: string,
  range: Period,
  page: PageArgs<"date">,
): Promise<Page<PersonService> | null> {
  if (!(await visibleStaffId(actor, id))) return null;

  const where = and(
    eq(services.createdBy, id),
    gte(services.serviceDate, range.from),
    lte(services.serviceDate, range.to),
  );

  const rows = await db
    .select({
      service: services,
      typeName: serviceTypes.name,
      coefficient: serviceTypes.coefficient,
      customerName: customers.fullName,
    })
    .from(services)
    .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
    .innerJoin(customers, eq(customers.id, services.customerId))
    .where(where)
    .orderBy(...orderedBy(services.serviceDate, page.dir, services.id))
    .limit(page.limit)
    .offset(page.offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(services)
    .where(where);

  return {
    rows: rows.map((r) => ({
      id: r.service.id,
      date: r.service.serviceDate,
      customerId: r.service.customerId,
      customerName: r.customerName,
      serviceType: r.typeName,
      ward: r.service.wardName ?? "",
      points: Number(r.coefficient),
    })),
    total,
  };
}

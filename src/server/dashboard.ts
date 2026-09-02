import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DashboardData, DashboardDraftAccount, DepartmentRanking } from "@/lib/api/dashboard";
import { BUSINESS_TIMEZONE, businessDay, monthRange } from "@/lib/format";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  customers,
  departments,
  giftGrants,
  insuranceOrders,
  kpiScores,
  referralCodes,
  serviceTypes,
  services,
  users,
} from "./db/schema";
import { giftItemNames } from "./gift";
import { statsByDepartment, statsByStaff, type Range } from "./org";

/**
 * P-80 · Tổng quan — bốn cách nhìn, một bộ số liệu (chốt 06/08).
 *
 *   Giám đốc        toàn công ty
 *   Phó giám đốc    những phòng họ quản
 *   Trưởng/Phó phòng phòng của họ
 *   Nhân viên       chỉ số của chính mình (hồ sơ P-52 tự xem)
 */

/* ── Ai thấy tới đâu ───────────────────────────────────────────────────── */

export type DashboardVisibility =
  | { kind: "company" }
  | { kind: "departments"; departmentIds: string[] }
  /** Bản ghi do chính mình tạo — màn này đổi hẳn sang hồ sơ cá nhân. */
  | { kind: "personal" }
  | { kind: "none" };

/**
 * Phạm vi của màn Tổng quan đọc CHỨC VỤ, cố định theo chức vụ (chốt 13/08).
 *
 * ⚠️ Đây là NGOẠI LỆ có chủ ý của luật "chức vụ không phải nguồn quyền"
 * (`db/schema.ts`, AGENTS.md §6). Mọi màn khác vẫn kiểm quyền qua
 * `permissions.ts`; riêng màn này thì không.
 *
 * Lý do: một màn trộn số của ba module, mà ba module có thể được cấp ba phạm vi
 * khác nhau. Bản cũ lấy mức hẹp nhất trong số module CÓ quyền, và bỏ qua module
 * không có quyền — nên người chỉ có `ngân hàng` toàn công ty thấy trọn số bảo
 * hiểm và dịch vụ. Chữa bằng cách siết phép so thì màn của một người phụ thuộc
 * ba ô quyền rời nhau, không ai đoán trước được họ sẽ thấy gì.
 *
 * Chức vụ cho một câu trả lời duy nhất cho mỗi người, đọc ra được từ hồ sơ.
 */
export function dashboardVisibility(actor: User): DashboardVisibility {
  switch (actor.role) {
    case "director":
      return { kind: "company" };

    /** Phó GĐ không thuộc phòng nào — họ chỉ có danh sách phòng được giao quản. */
    case "deputy-director":
      return actor.managedDepartmentIds.length > 0
        ? { kind: "departments", departmentIds: actor.managedDepartmentIds }
        : { kind: "none" };

    /**
     * Trưởng phòng và Phó phòng đọc PHÒNG MÌNH THUỘC VỀ, không đọc danh sách
     * phòng quản: hai chức vụ này luôn quản đúng phòng đó, và `StaffForm` đã
     * ràng buộc chéo hai trường đó từ H9.
     */
    case "head":
    case "deputy-head":
      return actor.departmentId
        ? { kind: "departments", departmentIds: [actor.departmentId] }
        : { kind: "none" };

    default:
      return { kind: "personal" };
  }
}

/** Câu chữ hiện trên màn để người xem biết mình đang nhìn phạm vi nào. */
export async function visibilityLabel(v: DashboardVisibility): Promise<string> {
  if (v.kind === "company") return "Toàn công ty";
  if (v.kind === "personal") return "Của tôi";
  if (v.kind === "none") return "Không có dữ liệu";

  const rows = await db
    .select({ name: departments.name })
    .from(departments)
    .where(inArray(departments.id, v.departmentIds));
  // Liệt kê tên khi còn đọc được; nhiều hơn ba phòng thì tên dài hơn cả tiêu đề.
  return rows.length <= 3 ? rows.map((r) => r.name).join(" · ") : `${rows.length} phòng bạn quản`;
}

/* ── Kỳ xem ────────────────────────────────────────────────────────────── */

const dayBefore = (day: string): string =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

const monthBefore = (yearMonth: string): string => {
  const [y, m] = yearMonth.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

const daysBetween = (r: Range): number =>
  Math.round(
    (new Date(`${r.to}T00:00:00Z`).getTime() - new Date(`${r.from}T00:00:00Z`).getTime()) /
      86_400_000,
  ) + 1;

/** Đọc chuỗi kỳ của `PeriodPicker`: `today` · `this-month` · `range:từ:đến`. */
export function periodRanges(
  key: string,
  today: string,
): { current: Range; previous: Range | null } {
  if (key === "this-month") {
    const month = today.slice(0, 7);
    return { current: monthRange(month), previous: monthRange(monthBefore(month)) };
  }
  const picked = key.match(/^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (picked) return { current: { from: picked[1], to: picked[2] }, previous: null };

  const yesterday = dayBefore(today);
  return { current: { from: today, to: today }, previous: { from: yesterday, to: yesterday } };
}

/**
 * Độ chia của biểu đồ do ĐỘ DÀI KỲ quyết định, không cố định theo giờ: một
 * tháng chia theo giờ là 744 cột không ai đọc nổi.
 */
const bucketTypeFor = (r: Range): DashboardData["insurance"]["bucketType"] => {
  const days = daysBetween(r);
  if (days <= 1) return "hour";
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
};

/* ── Điều kiện phạm vi cho từng bảng ───────────────────────────────────── */

type Scoped = {
  departmentId: Parameters<typeof inArray>[0];
  createdBy: Parameters<typeof eq>[0];
};

/**
 * `undefined` = không lọc (toàn công ty); `false` = không dòng nào.
 *
 * Nhánh `personal` lọc theo NGƯỜI TẠO chứ không theo phòng — nhân viên xem chỉ
 * số của chính mình, không phải của đồng nghiệp cùng phòng (spec §1.1.2).
 */
const scopeCondition = (
  v: DashboardVisibility,
  actorId: string,
  cols: Scoped,
): SQL | undefined => {
  switch (v.kind) {
    case "company":
      return undefined;
    case "departments":
      return inArray(cols.departmentId, v.departmentIds) as SQL;
    case "personal":
      return eq(cols.createdBy, actorId) as SQL;
    default:
      return sql`false`;
  }
};

const bankingCols: Scoped = {
  departmentId: bankAccounts.createdByDepartmentId,
  createdBy: bankAccounts.createdBy,
};
const insuranceCols: Scoped = {
  departmentId: insuranceOrders.createdByDepartmentId,
  createdBy: insuranceOrders.createdBy,
};
const serviceCols: Scoped = {
  departmentId: services.createdByDepartmentId,
  createdBy: services.createdBy,
};

/* ── Từng khối số liệu ─────────────────────────────────────────────────── */

type BankingTotals = { accountsOpened: number; appsInstalled: number; customers: number };

const EMPTY_BANKING: BankingTotals = { accountsOpened: 0, appsInstalled: 0, customers: 0 };

/**
 * Tài khoản `done` mở trong kỳ. Bản `creating` là lượt giữ chỗ mã, chưa phải
 * tài khoản thật (spec §4.5).
 *
 * "App đã cài" đếm tài khoản có `app_installed` VÀ ngân hàng đó `counts_as_app`
 * — cùng định nghĩa với cảnh báo mềm ở `server/banking.ts` và với bảng phòng
 * ban P-91. Đây là phép ĐẾM dữ liệu thô, không phải công thức tính điểm.
 */
async function bankingTotals(
  v: DashboardVisibility,
  actorId: string,
  range: Range,
): Promise<BankingTotals> {
  const [row] = await db
    .select({
      accountsOpened: sql<number>`count(*)::int`,
      appsInstalled: sql<number>`count(*) filter (where ${bankAccounts.appInstalled} and ${banks.countsAsApp})::int`,
      customers: sql<number>`count(distinct ${bankAccounts.customerId})::int`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, range.from),
        lte(bankAccounts.openedDate, range.to),
        scopeCondition(v, actorId, bankingCols),
      ),
    );
  return row ?? EMPTY_BANKING;
}

const rateOf = (opened: number, installed: number): number =>
  opened === 0 ? 0 : Math.round((installed / opened) * 100);

/**
 * Đơn bảo hiểm đếm theo `order_date`, KHÔNG theo `start_date`.
 *
 * Hai cột trả lời hai câu khác nhau: `start_date` là ngày hợp đồng có hiệu lực
 * (người nhập chọn, có thể lùi hoặc tiến), còn thẻ ở đây hỏi "hôm nay đội tạo
 * được bao nhiêu đơn". Lấy nhầm cột thì một đơn lập hôm nay cho hợp đồng hiệu
 * lực tháng sau biến mất khỏi số của hôm nay.
 */
const createdInRange = (range: Range): SQL =>
  and(
    gte(insuranceOrders.orderDate, range.from),
    lte(insuranceOrders.orderDate, range.to),
  ) as SQL;

async function insuranceBlock(
  v: DashboardVisibility,
  actorId: string,
  range: Range,
): Promise<DashboardData["insurance"]> {
  const scope = scopeCondition(v, actorId, insuranceCols);

  const [totals] = await db
    .select({
      created: sql<number>`count(*)::int`,
      electric: sql<number>`count(*) filter (where ${insuranceOrders.product} = 'electric-accident')::int`,
      motorbike: sql<number>`count(*) filter (where ${insuranceOrders.product} = 'motorbike')::int`,
      completed: sql<number>`count(*) filter (where ${insuranceOrders.status} = 'done')::int`,
    })
    .from(insuranceOrders)
    .where(and(createdInRange(range), scope));

  /**
   * Đơn tồn là số TỨC THỜI — "ngay lúc này còn bao nhiêu đơn chưa xong" — nên
   * cố ý KHÔNG lọc theo kỳ. Lọc theo kỳ thì chọn "hôm nay" sẽ giấu mất đống đơn
   * tồn từ tuần trước, mà đó đúng là đống cần người xử lý nhất.
   */
  const [pending] = await db
    .select({
      bot: sql<number>`count(*) filter (where ${insuranceOrders.status} in ('queued','creating','pending-approval'))::int`,
      manual: sql<number>`count(*) filter (where ${insuranceOrders.status} in ('manual-queued','manual-progress'))::int`,
    })
    .from(insuranceOrders)
    .where(and(sql`${insuranceOrders.status} <> 'done'`, scope));

  const bucketType = bucketTypeFor(range);

  /**
   * Ba mức ngày trở lên chia theo `order_date`; riêng mức GIỜ phải lấy
   * `created_at`, vì `order_date` không có giờ.
   *
   * Hai cột trả lời hai câu hơi khác nhau, và ở đây khác đó là đúng: cột theo
   * ngày hỏi "ngày nào đội làm được nhiều đơn", còn cột theo giờ hỏi "khung giờ
   * nào đội ngồi nhập" — thứ chỉ `created_at` biết. Đơn nhập bù cho hôm trước
   * vì vậy nằm đúng ngày đã khai, nhưng mang khung giờ lúc gõ.
   */
  const bucket = {
    hour: {
      label: sql`to_char(${insuranceOrders.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'HH24:00')`,
      /**
       * Sắp theo CHÍNH NHÃN, không theo `min(created_at)`.
       *
       * Bộ lọc chọn dòng bằng `order_date` còn nhãn dựng từ `created_at`, nên
       * hai thứ hết đi cùng nhau: một đơn tạo hôm 04/08 lúc 19:00 rồi sửa ngày
       * tạo đơn về hôm nay vẫn lọt vào kỳ, và `min(created_at)` của nhóm 19:00
       * nhỏ hơn mọi mốc hôm nay → cột 19:00 nhảy lên đầu trục. Nhãn `HH24:00`
       * có đệm số 0 nên so chuỗi đã đúng thứ tự giờ.
       */
      order: sql`1`,
    },
    day: {
      label: sql`to_char(${insuranceOrders.orderDate}, 'DD/MM')`,
      order: sql`min(${insuranceOrders.orderDate})`,
    },
    week: {
      label: sql`'Tuần ' || to_char(${insuranceOrders.orderDate}, 'IW')`,
      order: sql`min(${insuranceOrders.orderDate})`,
    },
    month: {
      label: sql`to_char(${insuranceOrders.orderDate}, 'MM/YYYY')`,
      order: sql`min(${insuranceOrders.orderDate})`,
    },
  }[bucketType];

  const buckets = await db
    .select({
      label: sql<string>`${bucket.label}`.as("label"),
      electric: sql<number>`count(*) filter (where ${insuranceOrders.product} = 'electric-accident')::int`,
      motorbike: sql<number>`count(*) filter (where ${insuranceOrders.product} = 'motorbike')::int`,
    })
    .from(insuranceOrders)
    .where(and(createdInRange(range), scope))
    .groupBy(sql`1`)
    // Sắp theo MỐC THẬT chứ không theo nhãn: nhãn `DD/MM` xếp theo chuỗi thì
    // 01/09 đứng trước 31/08, và biểu đồ chạy ngược thời gian.
    .orderBy(bucket.order);

  const created = totals?.created ?? 0;
  return {
    createdToday: created,
    electricCount: totals?.electric ?? 0,
    motorbikeCount: totals?.motorbike ?? 0,
    completed: totals?.completed ?? 0,
    completedPercent: created === 0 ? 0 : Math.round(((totals?.completed ?? 0) / created) * 100),
    pending: (pending?.bot ?? 0) + (pending?.manual ?? 0),
    pendingBot: pending?.bot ?? 0,
    pendingManual: pending?.manual ?? 0,
    bucketType,
    buckets: buckets.map((b) => ({
      label: b.label,
      electric: b.electric,
      motorbike: b.motorbike,
    })),
  };
}

async function servicesBlock(
  v: DashboardVisibility,
  actorId: string,
  range: Range,
): Promise<DashboardData["services"]> {
  const scope = scopeCondition(v, actorId, serviceCols);
  const inRange = and(
    gte(services.serviceDate, range.from),
    lte(services.serviceDate, range.to),
    scope,
  );

  const [byType, wards] = await Promise.all([
    db
      .select({ label: serviceTypes.name, count: sql<number>`count(*)::int` })
      .from(services)
      .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
      .where(inRange)
      .groupBy(serviceTypes.name)
      .orderBy(sql`count(*) desc`),
    db
      .select({ name: services.wardName, count: sql<number>`count(*)::int` })
      .from(services)
      // Nhân viên ngoài Phòng Dự Án không có xã, `ward_name` null — gộp chúng
      // vào một nhóm "không xã" rồi lấy nhóm đó làm "xã nhiều nhất" là bịa.
      .where(and(inRange, sql`${services.wardName} is not null`))
      .groupBy(services.wardName)
      .orderBy(sql`count(*) desc`)
      .limit(1),
  ]);

  return {
    byType,
    topWard: { name: wards[0]?.name ?? "—", count: wards[0]?.count ?? 0 },
  };
}

/**
 * Quà đã tặng trong kỳ.
 *
 * Phạm vi đi theo NGƯỜI LẬP HỒ SƠ KHÁCH, cùng trục với điểm KPI (thể lệ câu
 * 7.11 và mục "Phòng Y"). Quà xét theo KHÁCH, khách thuộc người lập hồ sơ, nên
 * phần quà thuộc phòng của người đó — không phải phòng của người bấm nút phát.
 * Hai trục lệch nhau vì cấp quản lý cũng phát quà được cho khách của lính
 * (spec §5.2).
 *
 * Cột đọc là `customers.created_by_department_id`, snapshot lúc lập hồ sơ (#8).
 * Bản cũ nối sang `users` để tra phòng, mà cột đó là phòng HIỆN TẠI: người lập
 * hồ sơ chuyển phòng là kéo cả lịch sử phát quà sang phòng mới, tức số liệu
 * tháng cũ tự viết lại — đúng ca spec §1.1.5 cấm.
 */
async function giftsBlock(
  v: DashboardVisibility,
  actorId: string,
  range: Range,
): Promise<DashboardData["gifts"]> {
  const inRange = sql`(${giftGrants.grantedAt} at time zone ${BUSINESS_TIMEZONE})::date between ${range.from}::date and ${range.to}::date`;

  const scope =
    v.kind === "company"
      ? undefined
      : v.kind === "departments"
        ? inArray(customers.createdByDepartmentId, v.departmentIds)
        : v.kind === "personal"
          ? eq(customers.createdBy, actorId)
          : sql`false`;

  /**
   * Gộp theo MÃ món (#74), rồi mới đổi sang tên để hiện.
   *
   * Gộp theo tên thì admin đổi tên món ở P-82 là một món tách thành hai dòng —
   * tên cũ và tên mới — trong cùng một biểu đồ.
   *
   * Tên lấy từ DANH MỤC HIỆN TẠI, khác chỗ hiện quà của một khách: ở đó phải
   * đóng băng tên lúc phát (spec §5.3), còn ở đây là con số gộp của nhiều đợt,
   * và nhãn phải khớp với tên đội đang gọi món đó hôm nay.
   */
  const byCode = await db
    .select({ code: giftGrants.chosenItem, count: sql<number>`count(*)::int` })
    .from(giftGrants)
    .innerJoin(customers, eq(customers.id, giftGrants.customerId))
    .where(and(inRange, scope))
    .groupBy(giftGrants.chosenItem)
    .orderBy(sql`count(*) desc`);

  const names = await giftItemNames(byCode.map((r) => r.code));
  const byType = byCode.map((r) => ({ label: names.get(r.code) ?? r.code, count: r.count }));

  /**
   * "Đủ điều kiện nhưng chưa phát" — KHÔNG lọc theo kỳ đang xem.
   *
   * Đây là hàng tồn chứ không phải số liệu của một khoảng ngày: khách đủ điều
   * kiện từ tháng trước mà chưa ai phát thì vẫn đang chờ, giấu đi vì "ngoài kỳ"
   * là để họ chờ mãi.
   *
   * Đọc cột `customers.gift_basket` lưu sẵn, không chạy hàm luật cho từng khách —
   * chạy luật ở đây nghĩa là kéo cả kho tài khoản về mỗi lần mở màn Tổng quan
   * (AGENTS.md §5.2). Cột đó do `recomputeGiftCase` ghi.
   */
  // Cùng lý do với `scope` bên trên: đọc cột chụp lúc lập hồ sơ, không tra phòng
  // hiện tại của người lập.
  const giftScope =
    v.kind === "company"
      ? undefined
      : v.kind === "departments"
        ? inArray(customers.createdByDepartmentId, v.departmentIds)
        : v.kind === "personal"
          ? eq(customers.createdBy, actorId)
          : sql`false`;

  const [pendingRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customers)
    .where(
      and(
        sql`cardinality(${customers.giftBasket}) > 0`,
        sql`not exists (select 1 from ${giftGrants} g where g.customer_id = ${customers.id})`,
        giftScope,
      ),
    );

  return { byType, pending: pendingRow?.n ?? 0 };
}

/** Bốn con số của một dòng, dán từ hai kỳ — dùng chung cho bảng phòng và bảng nhân viên. */
type Counted = { accountsOpened: number; appsInstalled: number; customers: number };
const rankRow = (
  id: string,
  name: string,
  now: Counted | undefined,
  before: Counted | undefined,
): DepartmentRanking => ({
  id,
  name,
  accountsOpened: now?.accountsOpened ?? 0,
  appsInstalled: now?.appsInstalled ?? 0,
  customers: now?.customers ?? 0,
  previousInstallRate:
    before && before.accountsOpened > 0
      ? rateOf(before.accountsOpened, before.appsInstalled)
      : null,
});

/**
 * Bảng xếp hạng — PHÒNG hay NHÂN VIÊN, chọn theo chức vụ người xem (chốt 13/08).
 *
 * Trưởng phòng và Phó phòng chỉ thấy đúng phòng mình. Bảng phòng của họ có một
 * dòng, không so được với gì, nên đổi sang xếp hạng nhân viên trong phòng đó.
 *
 * Bảng phòng dùng chung `statsByDepartment` với P-91: hai màn hỏi đúng một câu,
 * viết hai phép gộp là hai chỗ sớm muộn lệch nhau.
 */
async function ranking(
  actor: User,
  v: DashboardVisibility,
  current: Range,
  previous: Range | null,
): Promise<{ kind: "department" | "staff"; rows: DepartmentRanking[] }> {
  // Nhân viên không có bảng xếp hạng: màn của họ là hồ sơ cá nhân.
  if (v.kind === "personal" || v.kind === "none") return { kind: "department", rows: [] };

  if (v.kind === "departments" && (actor.role === "head" || actor.role === "deputy-head")) {
    const [people, now, before] = await Promise.all([
      db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.departmentId, v.departmentIds)),
      statsByStaff(current, v.departmentIds),
      previous ? statsByStaff(previous, v.departmentIds) : Promise.resolve(null),
    ]);

    /**
     * Người đã CHUYỂN ĐI vẫn có dòng nếu họ còn số trong kỳ.
     *
     * `statsByStaff` lọc theo `created_by_department_id` trên bản ghi, mà lượt
     * chuyển phòng viết lại cột đó (chốt 13/08) — nên thực tế danh sách hai bên
     * luôn khớp. Gộp thêm cho chắc: thiếu một dòng thì tổng bảng nhân viên không
     * bằng dòng phòng đó trong bảng của Giám đốc, và không ai giải thích được.
     */
    const names = new Map(people.map((p) => [p.id, p.fullName]));
    for (const id of now.keys()) if (!names.has(id)) names.set(id, "Người đã chuyển đi");

    return {
      kind: "staff",
      rows: [...names].map(([id, name]) => rankRow(id, name, now.get(id), before?.get(id))),
    };
  }

  const [rows, now, before] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(
        v.kind === "company"
          ? and(eq(departments.active, true), eq(departments.type, "sales"))
          : and(
              eq(departments.active, true),
              eq(departments.type, "sales"),
              inArray(departments.id, v.departmentIds),
            ),
      ),
    statsByDepartment(current),
    previous ? statsByDepartment(previous) : Promise.resolve(null),
  ]);

  return {
    kind: "department",
    rows: rows.map((d) => rankRow(d.id, d.name, now.get(d.id), before?.get(d.id))),
  };
}

/* ── Điểm tổng toàn công ty ────────────────────────────────────────────── */

/**
 * Tổng điểm KPI của CẢ CÔNG TY trong tháng — chỉ tính cho người xem phạm vi
 * toàn công ty (P-80, chốt 2026-09-03).
 *
 * Đọc thẳng `kpi_scores`, không tính lại: bảng đó là số đã chốt, cùng nguồn với
 * bảng xếp hạng và với lương. Tính lại ở đây là dựng đường thứ hai ra cùng con
 * số, và hai đường sớm muộn lệch nhau.
 *
 * ⚠️ Điểm KPI ghi theo THÁNG (`year_month`), còn kỳ xem của màn có thể là một
 * ngày hoặc một khoảng tuỳ chọn. Hàm lấy tháng của NGÀY CUỐI kỳ, và trả kèm
 * `yearMonth` để màn nói rõ số này của tháng nào.
 */
async function companyPoints(range: Range): Promise<{ yearMonth: string; points: number }> {
  const yearMonth = range.to.slice(0, 7);
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${kpiScores.bankingPoints} + ${kpiScores.servicePoints}), 0)`,
    })
    .from(kpiScores)
    .where(eq(kpiScores.yearMonth, yearMonth));

  // `sum` của Postgres trả numeric dạng chuỗi. Làm tròn một chữ số như mọi con
  // số điểm khác trong hệ thống.
  return { yearMonth, points: Math.round(Number(row?.total ?? 0) * 10) / 10 };
}

/* ── Ghép lại ──────────────────────────────────────────────────────────── */

export async function dashboardFor(
  actor: User,
  periodKey: string,
): Promise<{ data: DashboardData; scopeLabel: string }> {
  const v = dashboardVisibility(actor);
  const { current, previous } = periodRanges(periodKey, businessDay());

  const [banking, previousBanking, insurance, servicesData, gifts, ranked, scopeLabel, company] =
    await Promise.all([
      bankingTotals(v, actor.id, current),
      previous ? bankingTotals(v, actor.id, previous) : Promise.resolve(null),
      insuranceBlock(v, actor.id, current),
      servicesBlock(v, actor.id, current),
      giftsBlock(v, actor.id, current),
      ranking(actor, v, current, previous),
      visibilityLabel(v),
      // Chỉ người xem toàn công ty mới thấy ô này, nên người khác không tốn
      // thêm một câu truy vấn.
      v.kind === "company" ? companyPoints(current) : Promise.resolve(null),
    ]);

  return {
    scopeLabel,
    data: {
      installRate: {
        percent: rateOf(banking.accountsOpened, banking.appsInstalled),
        appsInstalled: banking.appsInstalled,
        accountsOpened: banking.accountsOpened,
        // Kỳ trước không mở tài khoản nào thì KHÔNG có tỉ lệ để so: 0% so với
        // "chưa có gì" là phép trừ vô nghĩa, và mũi tên giảm đọc ra như tai nạn.
        previousPercent:
          previousBanking && previousBanking.accountsOpened > 0
            ? rateOf(previousBanking.accountsOpened, previousBanking.appsInstalled)
            : null,
      },
      banking: {
        accountsOpened: banking.accountsOpened,
        appsInstalled: banking.appsInstalled,
        customers: banking.customers,
        giftsPending: gifts.pending,
      },
      insurance,
      companyPoints: company,
      rankingKind: ranked.kind,
      departments: ranked.rows,
      services: servicesData,
      gifts,
    },
  };
}

/**
 * Tài khoản `creating` do CHÍNH người này tạo — việc đang dở cần làm nốt, hiện
 * ở mặt `personal` của màn Tổng quan. Mới tạo nhất đứng đầu.
 *
 * Không cắt trang: bản `creating` là trạng thái tạm, mỗi người chỉ dở dang vài
 * cái một lúc — hoàn thành hoặc xoá là dòng rời danh sách.
 */
export async function draftAccountsFor(actorId: string): Promise<DashboardDraftAccount[]> {
  return db
    .select({
      id: bankAccounts.id,
      bankCode: banks.code,
      referralCode: referralCodes.displayName,
      customerId: bankAccounts.customerId,
      customerName: customers.fullName,
      createdAt: sql<string>`to_char(${bankAccounts.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD')`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(and(eq(bankAccounts.status, "creating"), eq(bankAccounts.createdBy, actorId)))
    .orderBy(desc(bankAccounts.createdAt));
}

import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DashboardData, DepartmentRanking } from "@/lib/api/dashboard";
import { BUSINESS_TIMEZONE, businessDay, monthRange } from "@/lib/format";
import { SCOPES, type Scope, type User } from "@/lib/types";
import { scopeFor } from "@/lib/permissions";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  departments,
  giftGrants,
  insuranceOrders,
  serviceTypes,
  services,
  users,
} from "./db/schema";
import { statsByDepartment, type Range } from "./org";

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
 * Phạm vi của màn tổng quan lấy theo mức HẸP NHẤT trong ba module nghiệp vụ.
 *
 * Một màn trộn số của cả ba (ngân hàng · bảo hiểm · dịch vụ) mà mỗi module một
 * phạm vi thì không có cách nào ghi nhãn cho đúng. Lấy mức hẹp nhất là hướng
 * an toàn: người chỉ được xem dịch vụ toàn công ty nhưng ngân hàng phần mình sẽ
 * KHÔNG thấy số ngân hàng của công ty ở đây. Thực tế ba module luôn cùng mức —
 * bộ quyền mặc định cấp chúng theo cụm — nên luật này hầu như không phải cân
 * nhắc, nhưng ngày ai đó cấp lệch tay thì nó nghiêng về phía đóng.
 */
export function dashboardVisibility(actor: User): DashboardVisibility {
  const scopes = (["banking", "insurance", "services"] as const)
    .map((m) => scopeFor(actor, m, "view-summary"))
    .filter((s): s is Scope => s !== null);
  if (scopes.length === 0) return { kind: "none" };

  const narrowest = scopes.reduce((a, b) => (SCOPES.indexOf(b) < SCOPES.indexOf(a) ? b : a));
  if (narrowest === "company") return { kind: "company" };
  if (narrowest === "own") return { kind: "personal" };

  /**
   * `phòng tôi quản` CỘNG phòng mình thuộc về.
   *
   * Phó GĐ không thuộc phòng nào nên chỉ còn danh sách phòng quản — đúng ý
   * "dashboard chỉ có phòng họ quản lý". Trưởng phòng và Phó phòng thì ngược
   * lại: nhiều người trong số họ chưa được gán quản phòng nào (`manage_scope =
   * 'none'`), nên nếu chỉ đọc danh sách quản thì màn của họ TRỐNG TRƠN — kể cả
   * phòng họ đang ngồi. Cộng thêm phòng mình thuộc về là đọc đúng chữ "phòng
   * họ" mà không phải đi sửa cơ cấu tổ chức trước.
   */
  const ids = new Set(actor.managedDepartmentIds);
  if (actor.departmentId) ids.add(actor.departmentId);
  return ids.size > 0 ? { kind: "departments", departmentIds: [...ids] } : { kind: "none" };
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
 * Phạm vi đi qua NGƯỜI PHÁT (`granted_by`) rồi tra phòng hiện tại của người đó,
 * vì `gift_grants` không chụp đơn vị lúc phát như ba bảng nghiệp vụ kia. Người
 * luân chuyển phòng vì vậy kéo cả lịch sử phát quà của họ sang phòng mới — sai
 * lệch đã biết, và chỉ chữa được bằng cách thêm cột chụp vào bảng.
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
        ? inArray(users.departmentId, v.departmentIds)
        : v.kind === "personal"
          ? eq(giftGrants.grantedBy, actorId)
          : sql`false`;

  const byType = await db
    .select({ label: giftGrants.chosenItem, count: sql<number>`count(*)::int` })
    .from(giftGrants)
    .innerJoin(users, eq(users.id, giftGrants.grantedBy))
    .where(and(inRange, scope))
    .groupBy(giftGrants.chosenItem)
    .orderBy(sql`count(*) desc`);

  /**
   * TODO(P-80 Tổng quan, chờ cột trạng thái quà lưu sẵn): "khách đủ điều kiện
   * nhưng chưa phát quà" luôn bằng 0.
   *
   * Luật đã có, nhưng đếm bằng cách chạy `giftFor` cho từng khách nghĩa là kéo
   * cả kho tài khoản về tầng ứng dụng mỗi lần mở màn Tổng quan. Con số này đi
   * cùng cột trạng thái quà của P-40 — dựng cột lưu sẵn ở đó thì thẻ này chỉ
   * còn là một câu `count`. Trả 0 chứ không bịa: một con số khác 0 ở thẻ này là
   * lệnh cho nhân viên đi phát quà.
   */
  return { byType, pending: 0 };
}

/**
 * Xếp hạng phòng — chỉ những phòng người xem được thấy.
 *
 * Dùng chung `statsByDepartment` với bảng P-91: hai màn hỏi đúng một câu, viết
 * hai phép gộp là hai chỗ sớm muộn lệch nhau.
 */
async function departmentRanking(
  v: DashboardVisibility,
  current: Range,
  previous: Range | null,
): Promise<DepartmentRanking[]> {
  // Nhân viên không có bảng xếp hạng phòng: màn của họ là hồ sơ cá nhân.
  if (v.kind === "personal" || v.kind === "none") return [];

  const [rows, now, before] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(
        v.kind === "company"
          ? eq(departments.active, true)
          : and(eq(departments.active, true), inArray(departments.id, v.departmentIds)),
      ),
    statsByDepartment(current),
    previous ? statsByDepartment(previous) : Promise.resolve(null),
  ]);

  return rows.map((d) => {
    const s = now.get(d.id);
    const p = before?.get(d.id);
    return {
      id: d.id,
      name: d.name,
      accountsOpened: s?.accountsOpened ?? 0,
      appsInstalled: s?.appsInstalled ?? 0,
      customers: s?.customers ?? 0,
      previousInstallRate:
        p && p.accountsOpened > 0 ? rateOf(p.accountsOpened, p.appsInstalled) : null,
    };
  });
}

/* ── Ghép lại ──────────────────────────────────────────────────────────── */

export async function dashboardFor(
  actor: User,
  periodKey: string,
): Promise<{ data: DashboardData; scopeLabel: string }> {
  const v = dashboardVisibility(actor);
  const { current, previous } = periodRanges(periodKey, businessDay());

  const [banking, previousBanking, insurance, servicesData, gifts, ranking, scopeLabel] =
    await Promise.all([
      bankingTotals(v, actor.id, current),
      previous ? bankingTotals(v, actor.id, previous) : Promise.resolve(null),
      insuranceBlock(v, actor.id, current),
      servicesBlock(v, actor.id, current),
      giftsBlock(v, actor.id, current),
      departmentRanking(v, current, previous),
      visibilityLabel(v),
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
      departments: ranking,
      services: servicesData,
      gifts,
    },
  };
}

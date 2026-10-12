import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { QuotaKindItem } from "@/lib/api/quota";
import { formatPoints, monthRange, roundPoints } from "@/lib/format";
import { customerDayBetween, customerDayText } from "../customerDay";
import { db } from "../db/client";
import {
  bankAccounts,
  channels,
  customers,
  departments,
  insuranceOrders,
  referralCodes,
  staffRoster,
  users,
} from "../db/schema";
import { YEARS_SQL } from "../exports";
import { bankingPointsByCustomer, pointsByDepartmentInRange } from "../kpi";
import { countQuotaAccounts, effectiveType, quotaConfigOf } from "../quota";

/**
 * Báo cáo ngày gửi Phó giám đốc qua Zalo (chốt 2026-10-12), loại thông báo
 * `pgd-daily-report` ở màn Bot Zalo. `scripts/pgd-daily-report.ts` in thử nội dung.
 *
 * Phạm vi: các phòng PGĐ quản TRONG tháng của ngày báo cáo, đọc `staff_roster`.
 *
 * Mỗi con số đi đúng nguồn của nơi đang hiện nó, để tin Zalo không lệch app:
 * - Khách theo NGÀY HỒ SƠ như KPI, phòng là phòng của người lập trong tháng đó.
 *   "App" là tài khoản hoàn thành không phải HKD: dòng HKD không phải ngân hàng.
 * - Điểm trong ngày là điểm ngân hàng của từng khách (`bankingPointsByCustomer`).
 *   Điểm tháng là điểm KPI của phòng, cùng số với màn Tổng quan.
 * - Năm BH là năm của đơn BH xe máy thật, không huỷ, theo ngày tạo đơn và phòng
 *   ghi nhận của đơn, cùng cột "Năm BH" của báo cáo đơn BH ở màn Xuất dữ liệu.
 * - VPa và HKD dùng danh sách loại tài khoản của Chỉ tiêu tháng (P-85). Số tháng
 *   đếm như phần lương (`countQuotaAccounts` theo phòng ghi nhận).
 */

type Counts = {
  multiApp: number;
  singleApp: number;
  points: number;
  insuranceYears: number;
  vpa: number;
  hkd: number;
};

const emptyCounts = (): Counts => ({
  multiApp: 0,
  singleApp: 0,
  points: 0,
  insuranceYears: 0,
  vpa: 0,
  hkd: 0,
});

export type ReportArea = Counts & { label: string };

/** `target` 0 = phòng chưa được giao chỉ tiêu này. */
export type QuotaProgress = { done: number; target: number };

export type ReportDepartment = Omit<Counts, "vpa" | "hkd"> & {
  id: string;
  name: string;
  vpa: QuotaProgress;
  hkd: QuotaProgress;
};

export type PgdDailyReport = {
  day: string;
  daysElapsed: number;
  daysInMonth: number;
  areas: ReportArea[];
  departments: ReportDepartment[];
};

/** Ấp in nguyên chuỗi trên hồ sơ ("Ấp, Xã, Tỉnh"); kênh khác in tên kênh kèm chi tiết. */
function areaLabel(channelName: string | null, inputKind: string | null, detail: string): string {
  if (!channelName) return "Không có kênh";
  if (inputKind === "ward-hamlet") return detail || channelName;
  if (!detail) return channelName;
  return inputKind === "hospital" ? `${channelName} ${detail}` : `${channelName}: ${detail}`;
}

const matchesKind = (kinds: QuotaKindItem[], bankId: string, type: string) =>
  kinds.some((k) => k.bankId === bankId && k.accountType === type);

export async function pgdDailyReport(pgdId: string, day: string): Promise<PgdDailyReport> {
  const month = day.slice(0, 7);
  const { from, to: monthEnd } = monthRange(month);
  const [pgd] = await db
    .select({ departmentIds: staffRoster.managedDepartmentIds })
    .from(users)
    .leftJoin(staffRoster, and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, month)))
    .where(eq(users.id, pgdId));

  const report: PgdDailyReport = {
    day,
    daysElapsed: Number(day.slice(8)),
    daysInMonth: Number(monthEnd.slice(8)),
    areas: [],
    departments: [],
  };
  const departmentIds = pgd?.departmentIds ?? [];
  if (departmentIds.length === 0) return report;

  const inDepartments = and(
    eq(staffRoster.userId, customers.createdBy),
    eq(staffRoster.yearMonth, month),
  );

  const [departmentRows, quota, customerRows, accountRows, insuranceRows, monthPoints] =
    await Promise.all([
      db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(inArray(departments.id, departmentIds))
        .orderBy(asc(departments.name)),
      quotaConfigOf(month),
      db
        .select({
          id: customers.id,
          day: customerDayText,
          departmentId: staffRoster.departmentId,
          channelName: channels.name,
          inputKind: channels.inputKind,
          channelDetail: customers.channelDetail,
        })
        .from(customers)
        .innerJoin(staffRoster, inDepartments)
        .leftJoin(channels, eq(channels.id, customers.channelId))
        .where(and(customerDayBetween(from, day), inArray(staffRoster.departmentId, departmentIds))),
      db
        .select({
          customerId: bankAccounts.customerId,
          bankId: bankAccounts.bankId,
          type: sql<string>`${effectiveType}`,
        })
        .from(bankAccounts)
        .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
        .innerJoin(staffRoster, inDepartments)
        .leftJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
        .where(
          and(
            eq(bankAccounts.status, "done"),
            customerDayBetween(from, day),
            inArray(staffRoster.departmentId, departmentIds),
          ),
        ),
      db
        .select({
          day: sql<string>`${insuranceOrders.orderDate}::text`,
          departmentId: insuranceOrders.createdByDepartmentId,
          channelName: channels.name,
          inputKind: channels.inputKind,
          channelDetail: customers.channelDetail,
          years: sql<number>`sum(${YEARS_SQL})::int`,
        })
        .from(insuranceOrders)
        .innerJoin(customers, eq(customers.id, insuranceOrders.customerId))
        .leftJoin(channels, eq(channels.id, customers.channelId))
        .where(
          and(
            ne(insuranceOrders.status, "cancelled"),
            eq(insuranceOrders.product, "motorbike"),
            sql`${insuranceOrders.orderDate} between ${from}::date and ${day}::date`,
            inArray(insuranceOrders.createdByDepartmentId, departmentIds),
          ),
        )
        .groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`),
      pointsByDepartmentInRange({ from, to: day }),
    ]);

  const directedKinds = quota?.directedKinds ?? [];
  const hkdKinds = quota?.hkdKinds ?? [];
  const [vpaDone, hkdDone] = await Promise.all([
    countQuotaAccounts(month, directedKinds, "department", departmentIds, day),
    countQuotaAccounts(month, hkdKinds, "department", departmentIds, day),
  ]);

  const accountsOf = new Map<string, { apps: number; vpa: number; hkd: number }>();
  for (const a of accountRows) {
    const acc = accountsOf.get(a.customerId) ?? { apps: 0, vpa: 0, hkd: 0 };
    if (a.type !== "HKD") acc.apps += 1;
    if (matchesKind(directedKinds, a.bankId, a.type)) acc.vpa += 1;
    if (matchesKind(hkdKinds, a.bankId, a.type)) acc.hkd += 1;
    accountsOf.set(a.customerId, acc);
  }

  const dayCustomers = customerRows.filter((c) => c.day === day);
  const dayPoints = await bankingPointsByCustomer(
    dayCustomers.map((c) => c.id),
    month,
  );

  const areas = new Map<string, ReportArea>();
  const areaOf = (label: string): ReportArea => {
    const found = areas.get(label);
    if (found) return found;
    const made = { label, ...emptyCounts() };
    areas.set(label, made);
    return made;
  };

  const monthCounts = new Map(departmentRows.map((d) => [d.id, emptyCounts()]));

  for (const c of customerRows) {
    const acc = accountsOf.get(c.id);
    const multiApp = acc && acc.apps >= 2 ? 1 : 0;
    const singleApp = acc?.apps === 1 ? 1 : 0;
    const dept = c.departmentId ? monthCounts.get(c.departmentId) : undefined;
    if (dept) {
      dept.multiApp += multiApp;
      dept.singleApp += singleApp;
    }
    if (c.day !== day) continue;
    const area = areaOf(areaLabel(c.channelName, c.inputKind, c.channelDetail));
    area.multiApp += multiApp;
    area.singleApp += singleApp;
    area.vpa += acc?.vpa ?? 0;
    area.hkd += acc?.hkd ?? 0;
    area.points = roundPoints(area.points + (dayPoints.get(c.id) ?? 0));
  }

  for (const r of insuranceRows) {
    const dept = r.departmentId ? monthCounts.get(r.departmentId) : undefined;
    if (dept) dept.insuranceYears += r.years;
    if (r.day === day)
      areaOf(areaLabel(r.channelName, r.inputKind, r.channelDetail)).insuranceYears += r.years;
  }

  report.areas = [...areas.values()].sort(
    (a, b) => b.points - a.points || a.label.localeCompare(b.label, "vi"),
  );
  report.departments = departmentRows.map((d) => {
    const counts = monthCounts.get(d.id) ?? emptyCounts();
    const target = quota?.departments.get(d.id);
    return {
      id: d.id,
      name: d.name,
      multiApp: counts.multiApp,
      singleApp: counts.singleApp,
      points: monthPoints.get(d.id) ?? 0,
      insuranceYears: counts.insuranceYears,
      vpa: { done: vpaDone.get(d.id) ?? 0, target: target?.directed ?? 0 },
      hkd: { done: hkdDone.get(d.id) ?? 0, target: target?.hkd ?? 0 },
    };
  });
  return report;
}

const dayText = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

const percentOf = (done: number, target: number) => Math.round((done / target) * 100);

function progressLine(label: string, p: QuotaProgress): string {
  if (p.target <= 0) return `${label}: ${p.done} (chưa giao chỉ tiêu)`;
  const remaining = Math.max(0, p.target - p.done);
  return `${label}: ${p.done}/${p.target} (${percentOf(p.done, p.target)}%), còn ${remaining}`;
}

/** Chậm tiến độ: tỉ lệ đạt thấp hơn tỉ lệ số ngày đã qua của tháng. */
const isBehind = (p: QuotaProgress, elapsed: number) => p.target > 0 && p.done / p.target < elapsed;

/** Các khối của báo cáo, nối bằng một dòng trống. Tách tin chỉ cắt giữa hai khối. */
function reportBlocks(r: PgdDailyReport): string[] {
  const title = `BÁO CÁO NGÀY ${dayText(r.day)}`;
  if (r.departments.length === 0) return [`${title}\nChưa được giao quản lý phòng nào.`];

  const blocks = [`${title}\nPhòng: ${r.departments.map((d) => d.name).join(", ")}`];
  const areaTitle = "SỐ LIỆU TRONG NGÀY THEO ẤP";
  if (r.areas.length === 0) blocks.push(`${areaTitle}\nChưa có số liệu.`);
  else blocks.push(areaTitle);
  for (const a of r.areas)
    blocks.push(
      [
        a.label,
        `Khách 2-3 app: ${a.multiApp}`,
        `Khách 1 app: ${a.singleApp}`,
        `Điểm: ${formatPoints(a.points)}`,
        `Năm BH: ${a.insuranceYears}`,
        `VPa: ${a.vpa}`,
        `HKD: ${a.hkd}`,
      ].join("\n"),
    );

  const elapsed = r.daysElapsed / r.daysInMonth;
  blocks.push(
    [
      `TỔNG THÁNG ${r.day.slice(5, 7)}/${r.day.slice(0, 4)} TỚI NGÀY ${dayText(r.day)}`,
      `Đã qua ${r.daysElapsed}/${r.daysInMonth} ngày (${Math.round(elapsed * 100)}%).`,
    ].join("\n"),
  );
  for (const d of r.departments) {
    const lines = [
      d.name,
      `Khách 2-3 app: ${d.multiApp}`,
      `Khách 1 app: ${d.singleApp}`,
      `Điểm: ${formatPoints(d.points)}`,
      `Năm BH: ${d.insuranceYears}`,
      progressLine("VPa", d.vpa),
      progressLine("HKD", d.hkd),
    ];
    const behind = [
      isBehind(d.vpa, elapsed) && "VPa",
      isBehind(d.hkd, elapsed) && "HKD",
    ].filter(Boolean);
    if (behind.length > 0) lines.push(`CẢNH BÁO: chậm tiến độ ${behind.join(", ")}.`);
    blocks.push(lines.join("\n"));
  }
  return blocks;
}

export const pgdDailyReportText = (r: PgdDailyReport): string => reportBlocks(r).join("\n\n");

/**
 * Trần ký tự một tin. Zalo từ chối tin 3.470 ký tự ("Nội dung quá dài") ngày
 * 2026-10-12, tin 863 ký tự thì gửi được; trần thật chưa đo nên chọn số thấp.
 */
const MAX_MESSAGE_CHARS = 1500;

/** Báo cáo tách thành các tin không quá trần, phần sau mang tiêu đề kèm số phần. */
export function pgdDailyReportMessages(r: PgdDailyReport): string[] {
  const title = `BÁO CÁO NGÀY ${dayText(r.day)}`;
  const parts: string[][] = [[]];
  let size = 0;
  for (const block of reportBlocks(r)) {
    const current = parts[parts.length - 1];
    if (current.length > 0 && size + block.length + 2 > MAX_MESSAGE_CHARS - title.length - 10) {
      parts.push([block]);
      size = block.length;
    } else {
      current.push(block);
      size += block.length + 2;
    }
  }
  if (parts.length === 1) return [parts[0].join("\n\n")];
  return parts.map((blocks, i) => {
    const label = `(${i + 1}/${parts.length})`;
    const body = blocks.join("\n\n");
    return i === 0 ? body.replace(title, `${title} ${label}`) : `${title} ${label}\n\n${body}`;
  });
}

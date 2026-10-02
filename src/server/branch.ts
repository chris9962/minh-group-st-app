import { and, asc, eq, inArray } from "drizzle-orm";
import type { BranchDepartment, BranchSummary } from "@/lib/api/person";
import { quotaTargetFor } from "@/rules/salary";
import { db } from "./db/client";
import { departments, staffRoster } from "./db/schema";
import { pointsByStaffInRange } from "./kpi";
import { statsByDepartment, type Range } from "./org";
import { countQuotaAccounts, quotaConfigOf } from "./quota";
import { salaryForUsers } from "./salary";

type BranchNumbers = Omit<BranchDepartment, "id" | "name">;

const EMPTY: BranchNumbers = {
  staffCount: 0,
  accountsOpened: 0,
  appsInstalled: 0,
  installPercent: 0,
  points: 0,
  salary: 0,
  hkdAchieved: 0,
  hkdTarget: null,
  directedAchieved: 0,
  directedTarget: null,
};

const sumTargets = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b;

const percentOf = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

/**
 * Khối nhánh của MỘT Phó giám đốc ở hồ sơ P-52: từng phòng họ quản và dòng
 * tổng, cùng bốn con số màn Tổng quan của chính người đó hiện.
 *
 * Ba nguồn đã có sẵn, không tính lại:
 *   - tài khoản, app: `statsByDepartment`, cùng câu với bảng xếp hạng phòng
 *   - điểm: `pointsByStaffInRange`, gom theo người lập hồ sơ như bảng lương
 *   - lương: `salaryForUsers`, cộng mọi người đang làm trong phòng
 *
 * Tài khoản, app, điểm theo KỲ người xem chọn. Lương, chỉ tiêu, phòng phụ trách
 * và số người là của THÁNG chứa kỳ đó (chốt 2026-09-30), đọc theo nhân sự của
 * tháng: lương không tính theo khoảng ngày.
 */
export async function branchSummaryFor(subjectId: string, range: Range): Promise<BranchSummary> {
  const salaryMonth = range.from.slice(0, 7);
  const [subject] = await db
    .select({ managedDepartmentIds: staffRoster.managedDepartmentIds })
    .from(staffRoster)
    .where(and(eq(staffRoster.userId, subjectId), eq(staffRoster.yearMonth, salaryMonth)))
    .limit(1);
  const managedIds = subject?.managedDepartmentIds ?? [];
  const managed = managedIds.length
    ? await db
        .select({ id: departments.id, name: departments.name, code: departments.code })
        .from(departments)
        .where(and(inArray(departments.id, managedIds), eq(departments.type, "sales")))
        .orderBy(asc(departments.name))
    : [];
  if (managed.length === 0) return { salaryMonth, departments: [], totals: EMPTY };

  const ids = managed.map((d) => d.id);
  const [people, stats, points] = await Promise.all([
    db
      .select({
        id: staffRoster.userId,
        departmentId: staffRoster.departmentId,
        role: staffRoster.role,
      })
      .from(staffRoster)
      .where(
        and(
          eq(staffRoster.yearMonth, salaryMonth),
          eq(staffRoster.active, true),
          inArray(staffRoster.departmentId, ids),
        ),
      ),
    statsByDepartment(range),
    pointsByStaffInRange(range),
  ]);
  const [salaries, quota] = await Promise.all([
    salaryForUsers(
      people.map((p) => p.id),
      salaryMonth,
    ),
    quotaConfigOf(salaryMonth),
  ]);
  // Theo tháng lương như cột lương, không theo kỳ lọc: chỉ tiêu tính theo tháng.
  const [hkdCounts, directedCounts] = await Promise.all([
    countQuotaAccounts(salaryMonth, quota?.hkdKinds ?? [], "department", ids),
    countQuotaAccounts(salaryMonth, quota?.directedKinds ?? [], "department", ids),
  ]);

  const targetOf = (target: number | null | undefined, code: string): number | null =>
    target == null ? null : quotaTargetFor(salaryMonth, target, code);

  const pointsByDepartment = new Map<string, number>();
  for (const { departmentId, points: p } of points.values()) {
    if (!departmentId) continue;
    pointsByDepartment.set(departmentId, (pointsByDepartment.get(departmentId) ?? 0) + p);
  }

  const rows: BranchDepartment[] = managed.map((d) => {
    const members = people.filter((p) => p.departmentId === d.id);
    const stat = stats.get(d.id);
    const accountsOpened = stat?.accountsOpened ?? 0;
    const appsInstalled = stat?.appsInstalled ?? 0;
    return {
      id: d.id,
      name: d.name,
      staffCount: members.filter((p) => ["staff", "deputy-head", "head"].includes(p.role)).length,
      accountsOpened,
      appsInstalled,
      installPercent: percentOf(appsInstalled, accountsOpened),
      points: Math.round((pointsByDepartment.get(d.id) ?? 0) * 10) / 10,
      salary: members.reduce((sum, p) => sum + (salaries.get(p.id)?.amount ?? 0), 0),
      hkdAchieved: hkdCounts.get(d.id) ?? 0,
      hkdTarget: targetOf(quota?.departments.get(d.id)?.hkd, d.code),
      directedAchieved: directedCounts.get(d.id) ?? 0,
      directedTarget: targetOf(quota?.departments.get(d.id)?.directed, d.code),
    };
  });

  const totals = rows.reduce<BranchNumbers>(
    (t, r) => ({
      staffCount: t.staffCount + r.staffCount,
      accountsOpened: t.accountsOpened + r.accountsOpened,
      appsInstalled: t.appsInstalled + r.appsInstalled,
      installPercent: 0,
      points: Math.round((t.points + r.points) * 10) / 10,
      salary: t.salary + r.salary,
      hkdAchieved: t.hkdAchieved + r.hkdAchieved,
      hkdTarget: sumTargets(t.hkdTarget, r.hkdTarget),
      directedAchieved: t.directedAchieved + r.directedAchieved,
      directedTarget: sumTargets(t.directedTarget, r.directedTarget),
    }),
    EMPTY,
  );
  totals.installPercent = percentOf(totals.appsInstalled, totals.accountsOpened);

  return { salaryMonth, departments: rows, totals };
}

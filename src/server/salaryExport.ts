import { and, eq, inArray, sql } from "drizzle-orm";
import type { DirectedExportRow, DirectedResult, SalaryExportRow } from "@/lib/api/exports";
import { monthRange, roundPoints } from "@/lib/format";
import { ROLE_RANK } from "@/lib/types";
import { accountCustomerDayBetween } from "./customerDay";
import { db } from "./db/client";
import {
  bankAccounts,
  departmentPointExclusions,
  departments,
  kpiAdjustments,
  kpiScores,
  staffRoster,
  users,
} from "./db/schema";
import { quotaProgressFor, salaryForUsers } from "./salary";

/**
 * P-73 báo cáo Lương. Lương đi qua `salaryForUsers` như mọi màn, nên tháng đã
 * chốt ra đúng số đã chốt.
 *
 * Người đã nghỉ chỉ có dòng khi có app, điểm, điểm cộng/trừ hoặc lương khác 0,
 * hoặc khi bị đánh dấu không tính điểm phòng.
 */
export async function listSalaryExport(yearMonth: string): Promise<SalaryExportRow[]> {
  const salesDepartments = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.type, "sales"));
  const salesName = new Map(salesDepartments.map((d) => [d.id, d.name]));

  const roster = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      staffCode: users.staffCode,
      role: staffRoster.role,
      active: staffRoster.active,
      departmentId: staffRoster.departmentId,
      managedDepartmentIds: staffRoster.managedDepartmentIds,
      points: sql<number>`(coalesce(${kpiScores.bankingPoints}, 0) + coalesce(${kpiScores.servicePoints}, 0) + coalesce(${kpiScores.socialInsurancePoints}, 0))::float`,
    })
    .from(users)
    .innerJoin(
      staffRoster,
      and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, yearMonth)),
    )
    .leftJoin(kpiScores, and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, yearMonth)))
    .where(inArray(staffRoster.role, ["staff", "deputy-head", "head", "deputy-director"]));

  const picked = roster.filter((r) =>
    r.role === "deputy-director"
      ? (r.managedDepartmentIds ?? []).some((id) => salesName.has(id))
      : r.departmentId !== null && salesName.has(r.departmentId),
  );
  const ids = picked.map((r) => r.id);
  if (ids.length === 0) return [];

  const { from, to } = monthRange(yearMonth);
  const [adjustmentRows, exclusionRows, accountRows, salaries] = await Promise.all([
    db
      .select({
        userId: kpiAdjustments.userId,
        plus: sql<number>`coalesce(sum(${kpiAdjustments.points}) filter (where ${kpiAdjustments.points} > 0), 0)::float`,
        minus: sql<number>`coalesce(sum(${kpiAdjustments.points}) filter (where ${kpiAdjustments.points} < 0), 0)::float`,
        plusReason: sql<string>`coalesce(string_agg(distinct ${kpiAdjustments.reason}, '; ') filter (where ${kpiAdjustments.points} > 0), '')`,
        minusReason: sql<string>`coalesce(string_agg(distinct ${kpiAdjustments.reason}, '; ') filter (where ${kpiAdjustments.points} < 0), '')`,
      })
      .from(kpiAdjustments)
      .where(and(eq(kpiAdjustments.yearMonth, yearMonth), inArray(kpiAdjustments.userId, ids)))
      .groupBy(kpiAdjustments.userId),
    db
      .select({ userId: departmentPointExclusions.userId, note: departmentPointExclusions.note })
      .from(departmentPointExclusions)
      .where(
        and(
          eq(departmentPointExclusions.yearMonth, yearMonth),
          inArray(departmentPointExclusions.userId, ids),
        ),
      ),
    db
      .select({
        createdBy: bankAccounts.createdBy,
        all: sql<number>`count(*) filter (where ${bankAccounts.status} in ('done', 'error', 'fixed'))::int`,
        broken: sql<number>`count(*) filter (where ${bankAccounts.status} in ('error', 'fixed'))::int`,
      })
      .from(bankAccounts)
      .where(and(inArray(bankAccounts.createdBy, ids), accountCustomerDayBetween(from, to)))
      .groupBy(bankAccounts.createdBy),
    salaryForUsers(ids, yearMonth),
  ]);
  const adjustments = new Map(adjustmentRows.map((r) => [r.userId, r]));
  const exclusions = new Map(exclusionRows.map((r) => [r.userId, r.note]));
  const accounts = new Map(accountRows.map((r) => [r.createdBy, r]));

  const rows: SalaryExportRow[] = picked.map((r) => {
    const adjustment = adjustments.get(r.id);
    const account = accounts.get(r.id);
    return {
      fullName: r.fullName,
      staffCode: r.staffCode ?? "",
      role: r.role,
      active: r.active,
      departmentName:
        r.role === "deputy-director"
          ? (r.managedDepartmentIds ?? [])
              .filter((id) => salesName.has(id))
              .map((id) => salesName.get(id)!)
              .sort((a, b) => a.localeCompare(b, "vi", { numeric: true }))
              .join(", ")
          : salesName.get(r.departmentId!)!,
      appsAll: account?.all ?? 0,
      appsBroken: account?.broken ?? 0,
      points: roundPoints(r.points),
      minusPoints: roundPoints(adjustment?.minus ?? 0),
      minusReason: adjustment?.minusReason ?? "",
      plusPoints: roundPoints(adjustment?.plus ?? 0),
      plusReason: adjustment?.plusReason ?? "",
      salary: salaries.get(r.id)?.amount ?? 0,
      excludedNote: exclusions.get(r.id) ?? null,
    };
  });

  const hasData = (r: SalaryExportRow) =>
    [r.appsAll, r.points, r.minusPoints, r.plusPoints, r.salary].some((v) => v !== 0);
  return rows
    .filter((r) => r.active || r.excludedNote !== null || hasData(r))
    .sort(
      (a, b) =>
        Number(a.role !== "deputy-director") - Number(b.role !== "deputy-director") ||
        a.departmentName.localeCompare(b.departmentName, "vi", { numeric: true }) ||
        ROLE_RANK[b.role] - ROLE_RANK[a.role] ||
        a.fullName.localeCompare(b.fullName, "vi"),
    );
}

/**
 * P-73 báo cáo Tài khoản định hướng. Người bị chấm và số đã đạt lấy từ
 * `quotaProgressFor`, câu chấm lấy từ dòng lương, nên khớp đúng bảng lương.
 * Người đã nghỉ chỉ có dòng khi có tài khoản định hướng hoặc có lương.
 */
export async function listDirectedExport(
  yearMonth: string,
  result: DirectedResult | null,
): Promise<DirectedExportRow[]> {
  const staff = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      staffCode: users.staffCode,
      role: staffRoster.role,
      contractType: staffRoster.contractType,
      active: staffRoster.active,
      departmentId: staffRoster.departmentId,
      departmentCode: departments.code,
      departmentType: departments.type,
      departmentName: departments.name,
    })
    .from(users)
    .innerJoin(
      staffRoster,
      and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, yearMonth)),
    )
    .innerJoin(departments, eq(departments.id, staffRoster.departmentId))
    .where(and(eq(staffRoster.role, "staff"), eq(departments.type, "sales")));

  const quota = await quotaProgressFor(yearMonth, staff, []);
  const scored = staff.flatMap((s) => {
    const progress = quota.staff(s.id);
    return progress ? [{ ...s, ...progress }] : [];
  });
  if (scored.length === 0) return [];

  const salaries = await salaryForUsers(scored.map((s) => s.id), yearMonth);
  return scored
    .filter((s) => s.active || s.achieved > 0 || (salaries.get(s.id)?.amount ?? 0) > 0)
    .filter((s) => result === null || (s.achieved >= s.target) === (result === "reached"))
    .map((s) => ({
      fullName: s.fullName,
      staffCode: s.staffCode ?? "",
      departmentName: s.departmentName,
      active: s.active,
      achieved: s.achieved,
      target: s.target,
      result: salaries.get(s.id)?.facts.find((f) => f.label === "Tài khoản định hướng")?.value ?? "",
    }))
    .sort(
      (a, b) =>
        a.departmentName.localeCompare(b.departmentName, "vi", { numeric: true }) ||
        a.fullName.localeCompare(b.fullName, "vi"),
    );
}

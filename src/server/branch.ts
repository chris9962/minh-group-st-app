import { and, asc, eq, inArray } from "drizzle-orm";
import type { BranchDepartment, BranchSummary } from "@/lib/api/person";
import { businessMonth } from "@/lib/format";
import { db } from "./db/client";
import { departments, userManagedDepartments, users } from "./db/schema";
import { pointsByStaffInRange } from "./kpi";
import { statsByDepartment, type Range } from "./org";
import { salaryForUsers } from "./salary";

type BranchNumbers = Omit<BranchDepartment, "id" | "name">;

const EMPTY: BranchNumbers = {
  staffCount: 0,
  accountsOpened: 0,
  appsInstalled: 0,
  installPercent: 0,
  points: 0,
  salary: 0,
};

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
 * Tài khoản, app, điểm theo KỲ người xem chọn. Nhân viên và lương thì không:
 * lương là số của tháng, còn số người là số hiện tại.
 */
export async function branchSummaryFor(subjectId: string, range: Range): Promise<BranchSummary> {
  const salaryMonth = businessMonth();
  const managed = await db
    .select({ id: departments.id, name: departments.name })
    .from(userManagedDepartments)
    .innerJoin(
      departments,
      and(eq(departments.id, userManagedDepartments.departmentId), eq(departments.type, "sales")),
    )
    .where(eq(userManagedDepartments.userId, subjectId))
    .orderBy(asc(departments.name));
  if (managed.length === 0) return { salaryMonth, departments: [], totals: EMPTY };

  const ids = managed.map((d) => d.id);
  const [people, stats, points] = await Promise.all([
    db
      .select({ id: users.id, departmentId: users.departmentId, role: users.role })
      .from(users)
      .where(and(eq(users.active, true), inArray(users.departmentId, ids))),
    statsByDepartment(range),
    pointsByStaffInRange(range),
  ]);
  const salaries = await salaryForUsers(
    people.map((p) => p.id),
    salaryMonth,
  );

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
      staffCount: members.filter((p) => p.role === "staff").length,
      accountsOpened,
      appsInstalled,
      installPercent: percentOf(appsInstalled, accountsOpened),
      points: Math.round((pointsByDepartment.get(d.id) ?? 0) * 10) / 10,
      salary: members.reduce((sum, p) => sum + (salaries.get(p.id)?.amount ?? 0), 0),
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
    }),
    EMPTY,
  );
  totals.installPercent = percentOf(totals.appsInstalled, totals.accountsOpened);

  return { salaryMonth, departments: rows, totals };
}

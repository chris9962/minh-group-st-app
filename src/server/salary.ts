import { and, eq, inArray, sql } from "drizzle-orm";
import { monthRange } from "@/lib/format";
import type { RoleKey, User } from "@/lib/types";
import { salaryRulesFor, type SalaryFact, type SalaryItem } from "@/rules/salary";
import { db } from "./db/client";
import {
  departments,
  employeeWorkDays,
  kpiAdjustments,
  kpiScores,
  salaryClosings,
  salarySnapshots,
  userManagedDepartments,
  users,
} from "./db/schema";

export type SalaryBreakdown = {
  amount: number;
  month: string;
  facts: SalaryFact[];
  items: SalaryItem[];
};

const zeroSalary = (month: string): SalaryBreakdown => ({
  amount: 0,
  month,
  facts: [],
  items: [],
});

/**
 * Bỏ khoản bằng 0 cho gọn, nhưng giữ khoản đầu khi mọi khoản đều 0: danh sách
 * rỗng là dấu hiệu "chưa có công thức", không phải "lương 0".
 */
const nonZeroItems = (items: SalaryItem[]): SalaryItem[] => {
  const rounded = items.map((item) => ({ ...item, amount: Math.round(item.amount) }));
  const kept = rounded.filter((item) => item.amount !== 0);
  return kept.length > 0 ? kept : rounded.slice(0, 1);
};

const adjustmentExpr = (yearMonth: string) => sql<number>`coalesce((
  select sum(${kpiAdjustments.points})::float
  from ${kpiAdjustments}
  where ${kpiAdjustments.userId} = ${users.id}
    and ${kpiAdjustments.yearMonth} = ${yearMonth}
), 0)`;

const scoreExpr = (yearMonth: string) => sql<number>`(
  coalesce(${kpiScores.bankingPoints}, 0) +
  coalesce(${kpiScores.servicePoints}, 0) +
  ${adjustmentExpr(yearMonth)}
)::float`;

type Subject = {
  id: string;
  role: RoleKey;
  departmentId: string | null;
  departmentType: "sales" | "office" | null;
  points: number;
};

type StaffScore = {
  id: string;
  departmentId: string;
  role: RoleKey;
  active: boolean;
  points: number;
};

/**
 * Lương của tháng: tháng đã chốt đọc số đã lưu, tháng chưa chốt tính từ dữ
 * liệu mới nhất. Mọi màn hiện lương đi qua đây.
 */
export async function salaryForUsers(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SalaryBreakdown>> {
  const [closing] = await db
    .select({ yearMonth: salaryClosings.yearMonth })
    .from(salaryClosings)
    .where(eq(salaryClosings.yearMonth, yearMonth))
    .limit(1);
  return closing ? closedSalaries(userIds, yearMonth) : liveSalaries(userIds, yearMonth);
}

async function closedSalaries(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SalaryBreakdown>> {
  const result = new Map<string, SalaryBreakdown>();
  for (const id of userIds) result.set(id, zeroSalary(yearMonth));
  if (userIds.length === 0) return result;

  const rows = await db
    .select({
      userId: salarySnapshots.userId,
      amount: salarySnapshots.amount,
      breakdown: salarySnapshots.breakdown,
    })
    .from(salarySnapshots)
    .where(
      and(eq(salarySnapshots.yearMonth, yearMonth), inArray(salarySnapshots.userId, userIds)),
    );
  for (const row of rows)
    result.set(row.userId, { amount: row.amount, month: yearMonth, ...row.breakdown });
  return result;
}

/**
 * Lương CĐS đang chạy, tính theo file kỳ ở `src/rules/salary`.
 *
 * CASA và tài khoản định hướng đang bằng 0 theo chốt nghiệp vụ. Thành phần HKD
 * của cấp quản lý cũng chưa cộng vì database mới có sản lượng, chưa có chỉ tiêu
 * HKD theo phòng/tháng để quyết định đạt hay thiếu bao nhiêu phần trăm.
 *
 * ⚠️ Đọc phòng, chức vụ và trạng thái HIỆN TẠI của từng người. Chuyển phòng
 * sau tháng đó làm đổi lương tháng đó, nên tháng đã trả phải chốt lại.
 */
async function liveSalaries(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SalaryBreakdown>> {
  const result = new Map<string, SalaryBreakdown>();
  for (const id of userIds) result.set(id, zeroSalary(yearMonth));
  const rules = salaryRulesFor(yearMonth);
  if (userIds.length === 0 || !rules) return result;

  const points = scoreExpr(yearMonth);
  const subjects: Subject[] = await db
    .select({
      id: users.id,
      role: users.role,
      departmentId: users.departmentId,
      departmentType: departments.type,
      points,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .leftJoin(
      kpiScores,
      and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, yearMonth)),
    )
    .where(inArray(users.id, userIds));

  const deputyDirectorIds = subjects
    .filter((subject) => subject.role === "deputy-director")
    .map((subject) => subject.id);
  const managedRows = deputyDirectorIds.length
    ? await db
        .select({ userId: userManagedDepartments.userId, departmentId: departments.id })
        .from(userManagedDepartments)
        .innerJoin(
          departments,
          and(
            eq(departments.id, userManagedDepartments.departmentId),
            eq(departments.type, "sales"),
          ),
        )
        .where(inArray(userManagedDepartments.userId, deputyDirectorIds))
    : [];
  const managedByUser = new Map<string, string[]>();
  for (const row of managedRows) {
    const kept = managedByUser.get(row.userId);
    if (kept) kept.push(row.departmentId);
    else managedByUser.set(row.userId, [row.departmentId]);
  }

  const relevantDepartmentIds = [
    ...new Set([
      ...subjects
        .filter((subject) => subject.departmentType === "sales" && subject.departmentId)
        .map((subject) => subject.departmentId!),
      ...managedRows.map((row) => row.departmentId),
    ]),
  ];

  /**
   * Kéo cả Phó phòng và người đã nghỉ: "Tổng điểm nhánh" của PGĐ phải khớp tổng
   * điểm phòng ở màn Tổng quan (chốt 2026-09-22), mà màn đó cộng mọi người có
   * điểm trong tháng. Các phép đếm theo ĐẦU NGƯỜI bên dưới vẫn chỉ lấy nhân
   * viên đang làm, lọc ở `staffByDepartment`.
   */
  const scoreRows: StaffScore[] = relevantDepartmentIds.length
    ? await db
        .select({
          id: users.id,
          departmentId: users.departmentId,
          role: users.role,
          active: users.active,
          points,
        })
        .from(users)
        .leftJoin(
          kpiScores,
          and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, yearMonth)),
        )
        .where(
          and(
            inArray(users.role, ["staff", "deputy-head"]),
            inArray(users.departmentId, relevantDepartmentIds),
          ),
        ) as StaffScore[]
    : [];

  const { from, to } = monthRange(yearMonth);
  const [userDayRows, departmentDayRows] = await Promise.all([
    db
      .select({ userId: employeeWorkDays.userId, count: sql<number>`count(*)::int` })
      .from(employeeWorkDays)
      .where(
        and(
          inArray(employeeWorkDays.userId, userIds),
          sql`${employeeWorkDays.workDate} between ${from}::date and ${to}::date`,
        ),
      )
      .groupBy(employeeWorkDays.userId),
    relevantDepartmentIds.length
      ? db
          .select({
            departmentId: employeeWorkDays.departmentId,
            count: sql<number>`count(distinct ${employeeWorkDays.workDate})::int`,
          })
          .from(employeeWorkDays)
          .where(
            and(
              inArray(employeeWorkDays.departmentId, relevantDepartmentIds),
              sql`${employeeWorkDays.workDate} between ${from}::date and ${to}::date`,
            ),
          )
          .groupBy(employeeWorkDays.departmentId)
      : Promise.resolve([]),
  ]);
  const userDays = new Map(userDayRows.map((row) => [row.userId, row.count]));
  const departmentDays = new Map(
    departmentDayRows.map((row) => [row.departmentId, row.count]),
  );
  const staffByDepartment = new Map<string, number[]>();
  const branchPointsByDepartment = new Map<string, number>();
  for (const row of scoreRows) {
    branchPointsByDepartment.set(
      row.departmentId,
      (branchPointsByDepartment.get(row.departmentId) ?? 0) + row.points,
    );
    if (row.role !== "staff" || !row.active) continue;
    const kept = staffByDepartment.get(row.departmentId);
    if (kept) kept.push(row.points);
    else staffByDepartment.set(row.departmentId, [row.points]);
  }

  for (const subject of subjects) {
    let salary = null;

    if (subject.role === "staff" && subject.departmentType === "sales") {
      salary = rules.staff({ points: subject.points, workDays: userDays.get(subject.id) ?? 0 });
    } else if (
      (subject.role === "head" || subject.role === "deputy-head") &&
      subject.departmentType === "sales" &&
      subject.departmentId
    ) {
      salary = rules.manager({
        role: subject.role,
        points: subject.points,
        teamPoints: staffByDepartment.get(subject.departmentId) ?? [],
        workDays: departmentDays.get(subject.departmentId) ?? 0,
      });
    } else if (subject.role === "deputy-director" && rules.deputyDirector) {
      const managed = managedByUser.get(subject.id) ?? [];
      if (managed.length > 0)
        salary = rules.deputyDirector({
          teamPoints: managed.flatMap((departmentId) => staffByDepartment.get(departmentId) ?? []),
          branchPoints: managed.reduce(
            (sum, departmentId) => sum + (branchPointsByDepartment.get(departmentId) ?? 0),
            0,
          ),
        });
    }

    if (salary)
      result.set(subject.id, {
        amount: salary.amount,
        month: yearMonth,
        facts: salary.facts,
        items: nonZeroItems(salary.items),
      });
  }

  return result;
}

/* ── Chốt lương theo tháng ─────────────────────────────────────────────── */

export type SalaryClosingStatus = {
  month: string;
  closedAt: Date;
  closedByName: string;
};

export async function salaryClosingOf(yearMonth: string): Promise<SalaryClosingStatus | null> {
  const [row] = await db
    .select({ closedAt: salaryClosings.closedAt, closedByName: users.fullName })
    .from(salaryClosings)
    .innerJoin(users, eq(users.id, salaryClosings.closedBy))
    .where(eq(salaryClosings.yearMonth, yearMonth))
    .limit(1);
  return row ? { month: yearMonth, ...row } : null;
}

/**
 * Chốt lương một tháng: tính lương mọi người theo dữ liệu lúc bấm rồi lưu lại.
 * Trả `null` khi tháng đó đã chốt.
 *
 * Lấy cả người đã nghỉ: họ vẫn có lương của tháng họ còn làm. Chỉ lưu dòng có
 * công thức; người không có dòng đọc ra lương 0, giống lúc chưa chốt.
 */
export async function closeSalaryMonth(actor: User, yearMonth: string): Promise<number | null> {
  const everyone = await db.select({ id: users.id }).from(users);
  const salaries = await liveSalaries(
    everyone.map((row) => row.id),
    yearMonth,
  );
  const snapshots = [...salaries]
    .filter(([, salary]) => salary.items.length > 0)
    .map(([userId, salary]) => ({
      yearMonth,
      userId,
      amount: salary.amount,
      breakdown: { facts: salary.facts, items: salary.items },
    }));

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(salaryClosings)
      .values({ yearMonth, closedBy: actor.id })
      .onConflictDoNothing()
      .returning({ yearMonth: salaryClosings.yearMonth });
    if (inserted.length === 0) return null;
    if (snapshots.length > 0) await tx.insert(salarySnapshots).values(snapshots);
    return snapshots.length;
  });
}

/** Mở chốt: xoá số đã lưu, tháng đó quay về tính từ dữ liệu mới nhất. `false` khi chưa chốt. */
export async function reopenSalaryMonth(yearMonth: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.delete(salarySnapshots).where(eq(salarySnapshots.yearMonth, yearMonth));
    const deleted = await tx
      .delete(salaryClosings)
      .where(eq(salaryClosings.yearMonth, yearMonth))
      .returning({ yearMonth: salaryClosings.yearMonth });
    return deleted.length > 0;
  });
}

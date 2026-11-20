import { and, eq, inArray, sql } from "drizzle-orm";
import { KIND_LABEL, PLAN_LABEL } from "@/lib/api/socialInsurance";
import { businessMonth, monthRange } from "@/lib/format";
import { shiftMonth } from "@/lib/period";
import { finalSalaryOf, type SalaryAdjustment } from "@/lib/api/salaryAdjustments";
import type { AttendanceMode, ContractType, RoleKey, SalaryScheme, User } from "@/lib/types";
import {
  quotaTargetFor,
  salaryRulesFor,
  type DepartmentQuotaProgress,
  type MealFormula,
  type QuotaProgress,
  type SalaryFact,
  type SalaryRevenue,
  type SalaryItem,
  type SalaryRules,
} from "@/rules/salary";
import { countCasaAccounts } from "./casa";
import { lockSalaryMonth } from "./closedMonths";
import { db } from "./db/client";
import {
  departmentPointExclusions,
  departments,
  employeeWorkDays,
  kpiAdjustments,
  kpiScores,
  mealAllowanceRows,
  salaryAdvanceRequests,
  salaryClosings,
  salarySnapshots,
  staffRoster,
  users,
} from "./db/schema";
import { multiBankComboCounts, socialInsuranceGroupsOf } from "./kpi";
import { reachMemberWhere, reachPointsExpr, targetExpr } from "./reach";
import { countQuotaAccounts, quotaConfigOf } from "./quota";
import { liveSalaryAdjustments } from "./salaryAdjustments";

export type SalaryBreakdown = {
  /** Lương cuối cùng = `pointsAmount` + thưởng - trừ - ứng trước. Mọi màn hiện số này làm "Lương". */
  amount: number;
  /** Lương theo điểm, tổng các khoản `items`. */
  pointsAmount: number;
  month: string;
  facts: SalaryFact[];
  items: SalaryItem[];
  revenue?: SalaryRevenue;
  /** Ứng trước, thưởng, trừ lương của tháng. Tháng đã chốt đọc bản chụp lúc chốt. */
  adjustments: SalaryAdjustment[];
};

const zeroSalary = (month: string): SalaryBreakdown => ({
  amount: 0,
  pointsAmount: 0,
  month,
  facts: [],
  items: [],
  adjustments: [],
});

/**
 * Bỏ khoản bằng 0 cho gọn, nhưng giữ khoản đầu khi mọi khoản đều 0: danh sách
 * rỗng là dấu hiệu "chưa có công thức", không phải "lương 0".
 */
const nonZeroItems = (items: SalaryItem[]): SalaryItem[] => {
  // `|| 0` đổi -0 thành 0, không thì dòng giữ lại hiện "-0đ".
  const rounded = items.map((item) => ({ ...item, amount: Math.round(item.amount) || 0 }));
  const kept = rounded.filter((item) => item.amount !== 0 || item.keepAtZero);
  return (kept.length > 0 ? kept : rounded.slice(0, 1)).map(({ label, formula, amount }) => ({
    label,
    formula,
    amount,
  }));
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
  coalesce(${kpiScores.socialInsurancePoints}, 0) +
  ${adjustmentExpr(yearMonth)}
)::float`;

type Subject = {
  id: string;
  role: RoleKey;
  contractType: ContractType | null;
  salaryScheme: SalaryScheme;
  fixedSalary: number | null;
  active: boolean;
  departmentId: string | null;
  departmentCode: string | null;
  departmentType: "sales" | "office" | null;
  /** Phòng có chấm công thì Trưởng/Phó phòng ăn ca theo ngày tự chấm, không theo ngày của phòng. */
  attendanceMode: AttendanceMode | null;
  /** Trần ngày công của phòng có chấm công trong tháng đang tính; `null` là dùng trần của kỳ. */
  maxWorkDays: number | null;
  points: number;
};

/** Tháng 31 ngày đọc ô 31 ngày, tháng khác đọc ô dưới 31 ngày (chủ dự án chốt 2026-11-16). */
function maxWorkDaysOf(
  row: { attendanceMode: AttendanceMode | null; maxWorkDays31: number | null; maxWorkDaysUnder31: number | null },
  yearMonth: string,
): number | null {
  if (!row.attendanceMode) return null;
  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return daysInMonth === 31 ? row.maxWorkDays31 : row.maxWorkDaysUnder31;
}

type Formula = "fixed" | "staff" | "manager" | "deputy-director";

/**
 * Nhánh công thức lương của một người trong tháng; `null` là không có lương CĐS.
 * Màn Lương ăn ca đọc cùng hàm, để danh sách ăn ca đúng những người có dòng ăn ca trong lương.
 */
function formulaOf(subject: Subject, rules: SalaryRules, managedSalesCount: number, workDays: number): Formula | null {
  // Lương cứng đứng trước mọi nhánh chức vụ: Trưởng, Phó phòng An Sinh lương cứng không có lương quản lý.
  // Người đã khoá cuối tháng mà không có ngày công nào thì không nhận lương cứng của tháng đó.
  if (subject.salaryScheme === "fixed" && rules.fixed) return subject.active || workDays > 0 ? "fixed" : null;
  if (subject.role === "staff" && subject.departmentType === "sales") return "staff";
  if (
    (subject.role === "head" || subject.role === "deputy-head") &&
    subject.departmentType === "sales" &&
    subject.departmentId
  )
    return "manager";
  if (subject.role === "deputy-director" && rules.deputyDirector && managedSalesCount > 0) return "deputy-director";
  return null;
}

const mealFormulaOf = (formula: Formula, subject: Subject): MealFormula =>
  formula === "staff" && (subject.salaryScheme === "atm" || subject.salaryScheme === "social")
    ? subject.salaryScheme
    : formula;

/** Nhân sự của tháng, và các phòng kinh doanh mỗi Phó GĐ phụ trách. */
async function loadSubjects(userIds: string[], yearMonth: string) {
  // innerJoin: người chưa có tài khoản trong tháng đó không có dòng nhân sự của tháng.
  const rosterRows = await db
    .select({
      id: users.id,
      role: staffRoster.role,
      contractType: staffRoster.contractType,
      salaryScheme: staffRoster.salaryScheme,
      fixedSalary: staffRoster.fixedSalary,
      active: staffRoster.active,
      departmentId: staffRoster.departmentId,
      departmentCode: departments.code,
      departmentType: departments.type,
      attendanceMode: staffRoster.attendanceMode,
      maxWorkDays31: staffRoster.maxWorkDays31,
      maxWorkDaysUnder31: staffRoster.maxWorkDaysUnder31,
      managedDepartmentIds: staffRoster.managedDepartmentIds,
      points: scoreExpr(yearMonth),
    })
    .from(users)
    .innerJoin(
      staffRoster,
      and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, yearMonth)),
    )
    .leftJoin(departments, eq(departments.id, staffRoster.departmentId))
    .leftJoin(
      kpiScores,
      and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, yearMonth)),
    )
    .where(inArray(users.id, userIds));
  const subjects: Subject[] = rosterRows.map(({ maxWorkDays31, maxWorkDaysUnder31, ...row }) => ({
    ...row,
    maxWorkDays: maxWorkDaysOf({ attendanceMode: row.attendanceMode, maxWorkDays31, maxWorkDaysUnder31 }, yearMonth),
  }));

  const managedIdsByDeputyDirector = new Map(
    rosterRows
      .filter((row) => row.role === "deputy-director")
      .map((row) => [row.id, row.managedDepartmentIds] as const),
  );
  const allManagedIds = [...new Set([...managedIdsByDeputyDirector.values()].flat())];
  const managedSalesDepartments = allManagedIds.length
    ? await db
        .select({
          departmentId: departments.id,
          departmentCode: departments.code,
          departmentName: departments.name,
        })
        .from(departments)
        .where(and(inArray(departments.id, allManagedIds), eq(departments.type, "sales")))
    : [];
  const salesIds = new Set(managedSalesDepartments.map((row) => row.departmentId));
  const managedByUser = new Map<string, string[]>();
  for (const [userId, departmentIds] of managedIdsByDeputyDirector)
    managedByUser.set(userId, departmentIds.filter((departmentId) => salesIds.has(departmentId)));
  return { subjects, managedByUser, managedSalesDepartments };
}

/** Ngày công của từng người, và số ngày có ngày công của từng phòng, trong tháng. */
async function loadWorkDays(userIds: string[], departmentIds: string[], yearMonth: string) {
  const { from, to } = monthRange(yearMonth);
  const [userDayRows, departmentDayRows] = await Promise.all([
    db
      // Người chấm công có nửa ngày từ tháng 2026-10, nên cộng `fraction` chứ không đếm dòng.
      .select({ userId: employeeWorkDays.userId, count: sql<number>`sum(${employeeWorkDays.fraction})::float` })
      .from(employeeWorkDays)
      .where(
        and(
          inArray(employeeWorkDays.userId, userIds),
          sql`${employeeWorkDays.workDate} between ${from}::date and ${to}::date`,
        ),
      )
      .groupBy(employeeWorkDays.userId),
    departmentIds.length
      ? db
          .select({
            departmentId: employeeWorkDays.departmentId,
            count: sql<number>`count(distinct ${employeeWorkDays.workDate})::int`,
          })
          .from(employeeWorkDays)
          .where(
            and(
              inArray(employeeWorkDays.departmentId, departmentIds),
              sql`${employeeWorkDays.workDate} between ${from}::date and ${to}::date`,
            ),
          )
          .groupBy(employeeWorkDays.departmentId)
      : Promise.resolve([]),
  ]);
  return {
    userDays: new Map(userDayRows.map((row) => [row.userId, row.count])),
    departmentDays: new Map(departmentDayRows.map((row) => [row.departmentId, row.count])),
  };
}

/** Ngày công công thức lương dùng cho ăn ca: phòng có chấm công thì quản lý cũng chấm, như `listWorkDayExport`. */
const mealWorkDaysOf = (
  formula: Formula,
  subject: Subject,
  userDays: Map<string, number>,
  departmentDays: Map<string | null, number>,
): number =>
  formula === "manager" && !subject.attendanceMode
    ? (departmentDays.get(subject.departmentId) ?? 0)
    : (userDays.get(subject.id) ?? 0);

export type MealBasis = {
  /** Số ngày công lương đang dùng, đã cắt trần. */
  appDays: number;
  maxDays: number;
  /** Còn làm cuối tháng, theo nhân sự của tháng. */
  active: boolean;
  departmentId: string | null;
};

/**
 * Người có dòng "Hỗ trợ ăn ca" trong lương tháng, kèm số ngày app tính và trần.
 * Không suy ra từ kết quả lương: `nonZeroItems` bỏ dòng ăn ca 0đ.
 */
export async function mealBasisFor(userIds: string[], yearMonth: string): Promise<Map<string, MealBasis>> {
  const out = new Map<string, MealBasis>();
  const rules = salaryRulesFor(yearMonth);
  if (userIds.length === 0 || !rules?.mealMaxDays) return out;
  const { subjects, managedByUser } = await loadSubjects(userIds, yearMonth);
  const managerDepartmentIds = [
    ...new Set(
      subjects
        .filter((s) => (s.role === "head" || s.role === "deputy-head") && s.departmentType === "sales" && s.departmentId)
        .map((s) => s.departmentId!),
    ),
  ];
  const { userDays, departmentDays } = await loadWorkDays(userIds, managerDepartmentIds, yearMonth);
  for (const subject of subjects) {
    const formula = formulaOf(subject, rules, managedByUser.get(subject.id)?.length ?? 0, userDays.get(subject.id) ?? 0);
    if (!formula) continue;
    const maxDays = rules.mealMaxDays(mealFormulaOf(formula, subject), subject.maxWorkDays);
    const workDays = formula === "deputy-director" ? maxDays : mealWorkDaysOf(formula, subject, userDays, departmentDays);
    out.set(subject.id, {
      appDays: Math.min(workDays, maxDays),
      maxDays,
      active: subject.active,
      departmentId: subject.departmentId,
    });
  }
  return out;
}

/** Số ngày ở màn Lương ăn ca thay ngày công: số đã khoá, không thì số người duyệt sửa. */
async function mealDaysOverride(userIds: string[], yearMonth: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: mealAllowanceRows.userId,
      days: sql<number>`coalesce(${mealAllowanceRows.lockedDays}, ${mealAllowanceRows.editedDays})::float`,
    })
    .from(mealAllowanceRows)
    .where(
      and(
        eq(mealAllowanceRows.yearMonth, yearMonth),
        inArray(mealAllowanceRows.userId, userIds),
        sql`coalesce(${mealAllowanceRows.lockedDays}, ${mealAllowanceRows.editedDays}) is not null`,
      ),
    );
  return new Map(rows.map((row) => [row.userId, row.days]));
}

type StaffScore = {
  id: string;
  departmentId: string;
  role: RoleKey;
  points: number;
  /** Bị loại khỏi điểm phòng của tháng. */
  excluded: boolean;
};

type ReachRow = { departmentId: string; reachPoints: number; target: number };

/**
 * Lương của tháng: tháng đã chốt đọc số đã lưu, tháng chưa chốt tính từ dữ
 * liệu mới nhất. Mọi màn hiện lương đi qua đây.
 */
export async function salaryForUsers(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SalaryBreakdown>> {
  if (userIds.length === 0) return new Map();

  const rows = await db
    .select({
      userId: salarySnapshots.userId,
      amount: salarySnapshots.amount,
      breakdown: salarySnapshots.breakdown,
    })
    .from(salaryClosings)
    .leftJoin(
      salarySnapshots,
      and(
        eq(salarySnapshots.yearMonth, salaryClosings.yearMonth),
        inArray(salarySnapshots.userId, userIds),
      ),
    )
    .where(eq(salaryClosings.yearMonth, yearMonth));
  if (rows.length === 0) return withAdjustments(await liveSalaries(userIds, yearMonth), userIds, yearMonth);

  const result = new Map<string, SalaryBreakdown>();
  for (const id of userIds) result.set(id, zeroSalary(yearMonth));
  for (const row of rows)
    if (row.userId && row.amount !== null && row.breakdown)
      result.set(row.userId, {
        amount: row.amount,
        month: yearMonth,
        ...row.breakdown,
        // Bản chụp chốt trước 2026-10-31 chưa có hai trường này: khi đó lương đã lưu là lương theo điểm.
        pointsAmount: row.breakdown.pointsAmount ?? row.amount,
        adjustments: row.breakdown.adjustments ?? [],
      });
  return result;
}

async function withAdjustments(
  salaries: Map<string, SalaryBreakdown>,
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SalaryBreakdown>> {
  for (const [id, list] of await liveSalaryAdjustments(userIds, yearMonth)) {
    const salary = salaries.get(id);
    if (!salary) continue;
    salary.adjustments = list;
    salary.amount = finalSalaryOf(salary.pointsAmount, list);
  }
  return salaries;
}

/**
 * Lương CĐS đang chạy, tính theo file kỳ ở `src/rules/salary`.
 *
 * Chỉ tiêu QĐ 145 và tài khoản CASA đọc từ màn Chỉ tiêu tháng, xem `quotaProgressFor`.
 *
 * Phòng, chức vụ, loại hợp đồng, cách tính lương và phòng phụ trách đọc từ
 * `staffRoster` của ĐÚNG tháng đang tính (chốt 2026-09-30). Chuyển phòng hay
 * thêm người ở tháng sau không đổi lương tháng này. Điểm và ngày công vẫn tính
 * từ dữ liệu thật, nên tháng đã trả vẫn phải chốt.
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
  // Người chưa có tài khoản trong tháng đó không có dòng nhân sự của tháng, giữ lương 0 đã điền sẵn.
  const { subjects, managedByUser, managedSalesDepartments } = await loadSubjects(userIds, yearMonth);
  const salesDepartmentCode = new Map(
    managedSalesDepartments.map((row) => [row.departmentId, row.departmentCode]),
  );
  const salesDepartmentName = new Map(
    managedSalesDepartments.map((row) => [row.departmentId, row.departmentName]),
  );
  const managedRows: { userId: string; departmentId: string; departmentCode: string }[] = [];
  for (const [userId, sales] of managedByUser)
    for (const departmentId of sales)
      managedRows.push({
        userId,
        departmentId,
        departmentCode: salesDepartmentCode.get(departmentId)!,
      });

  // Đếm trên MỌI Phó GĐ của tháng, không riêng `userIds`: xem lương một người vẫn phải chia đúng.
  const deputyDirectorsByDepartment = new Map<string, number>();
  if (rules.deputyDirectorSharesDepartments && managedRows.length > 0) {
    const allDeputyDirectors = await db
      .select({ managedDepartmentIds: staffRoster.managedDepartmentIds })
      .from(staffRoster)
      .where(and(eq(staffRoster.yearMonth, yearMonth), eq(staffRoster.role, "deputy-director")));
    for (const departmentId of allDeputyDirectors.flatMap((row) => row.managedDepartmentIds))
      deputyDirectorsByDepartment.set(
        departmentId,
        (deputyDirectorsByDepartment.get(departmentId) ?? 0) + 1,
      );
  }
  const shareOf = (departmentId: string) => 1 / (deputyDirectorsByDepartment.get(departmentId) ?? 1);

  const relevantDepartmentIds = [
    ...new Set([
      ...subjects
        .filter((subject) => subject.departmentType === "sales" && subject.departmentId)
        .map((subject) => subject.departmentId!),
      ...managedRows.map((row) => row.departmentId),
    ]),
  ];

  /**
   * Kéo cả Trưởng, Phó phòng và người đã nghỉ: "Tổng điểm nhánh" của PGĐ cộng
   * mọi người có điểm trong phòng (chốt 2026-10-16), khớp tổng điểm phòng ở màn
   * Tổng quan. Điểm TB và các phép đếm theo ĐẦU NGƯỜI bên dưới chỉ lấy nhân
   * viên có điểm khác 0 trong tháng, kể cả người đã khoá (chốt 2026-09-30), lọc
   * ở `staffByDepartment`. Nhân viên bị loại khỏi điểm phòng không vào
   * cả hai phép tính (chốt 2026-10-18).
   */
  const scoreRows: StaffScore[] = relevantDepartmentIds.length
    ? await db
        .select({
          id: users.id,
          departmentId: staffRoster.departmentId,
          role: staffRoster.role,
          points,
          excluded: sql<boolean>`${departmentPointExclusions.userId} is not null`,
        })
        .from(users)
        .innerJoin(
          staffRoster,
          and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, yearMonth)),
        )
        .leftJoin(
          kpiScores,
          and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, yearMonth)),
        )
        .leftJoin(
          departmentPointExclusions,
          and(
            eq(departmentPointExclusions.userId, users.id),
            eq(departmentPointExclusions.yearMonth, yearMonth),
          ),
        )
        .where(
          and(
            inArray(staffRoster.role, ["staff", "deputy-head", "head"]),
            inArray(staffRoster.departmentId, relevantDepartmentIds),
          ),
        ) as StaffScore[]
    : [];
  // Cùng luật đếm với thẻ "đã đạt chỉ tiêu"; `reachMemberWhere` đã bỏ Nhân viên bị loại.
  const reachRows: ReachRow[] = relevantDepartmentIds.length
    ? await db
        .select({
          departmentId: staffRoster.departmentId,
          reachPoints: reachPointsExpr(points),
          target: sql<number>`${targetExpr(yearMonth, staffRoster.departmentId)}::float`,
        })
        .from(users)
        .innerJoin(
          staffRoster,
          and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, yearMonth)),
        )
        .leftJoin(
          kpiScores,
          and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, yearMonth)),
        )
        .where(
          and(
            reachMemberWhere(yearMonth),
            inArray(staffRoster.departmentId, relevantDepartmentIds),
          ),
        ) as ReachRow[]
    : [];

  const [{ userDays, departmentDays }, mealDaysOf] = await Promise.all([
    loadWorkDays(userIds, relevantDepartmentIds, yearMonth),
    rules.mealMaxDays ? mealDaysOverride(userIds, yearMonth) : Promise.resolve(new Map<string, number>()),
  ]);
  const staffByDepartment = new Map<string, number[]>();
  const branchPointsByDepartment = new Map<string, number>();
  for (const row of scoreRows) {
    // Dấu loại khỏi điểm phòng chỉ áp cho Nhân viên, cùng luật với `excludedStaffIn`.
    if (row.role === "staff" && row.excluded) continue;
    branchPointsByDepartment.set(
      row.departmentId,
      (branchPointsByDepartment.get(row.departmentId) ?? 0) + row.points,
    );
    if (row.role !== "staff" || row.points === 0) continue;
    const kept = staffByDepartment.get(row.departmentId);
    if (kept) kept.push(row.points);
    else staffByDepartment.set(row.departmentId, [row.points]);
  }
  const reachByDepartment = new Map<string, { points: number; target: number }[]>();
  for (const row of reachRows) {
    const member = { points: row.reachPoints, target: row.target };
    const kept = reachByDepartment.get(row.departmentId);
    if (kept) kept.push(member);
    else reachByDepartment.set(row.departmentId, [member]);
  }

  const quota = await quotaProgressFor(yearMonth, subjects, managedRows);

  const isAtmStaff = (s: Subject) =>
    s.role === "staff" && s.departmentType === "sales" && s.salaryScheme === "atm";
  const bonusCombos = await multiBankComboCounts(
    subjects.filter(isAtmStaff).map((s) => s.id),
    yearMonth,
  );
  const socialGroups = await socialInsuranceGroupsOf(
    subjects.filter((s) => s.salaryScheme === "social").map((s) => s.id),
    yearMonth,
  );

  for (const subject of subjects) {
    let salary = null;

    const workDays = userDays.get(subject.id) ?? 0;
    const mealDays = mealDaysOf.get(subject.id) ?? null;
    const managed = managedByUser.get(subject.id) ?? [];
    const formula = formulaOf(subject, rules, managed.length, workDays);
    if (formula === "fixed") {
      salary = rules.fixed!({ amount: subject.fixedSalary, workDays, maxWorkDays: subject.maxWorkDays, mealDays });
    } else if (formula === "staff") {
      salary = rules.staff({
        points: subject.points,
        workDays,
        mealDays,
        directedQuota: quota.staff(subject.id),
        casaAccounts: quota.casa(subject.id),
        scheme: subject.salaryScheme,
        bonusCombos: bonusCombos.get(subject.id) ?? 0,
        socialInsurance: (socialGroups.get(subject.id) ?? []).map((group) => ({
          label: `${KIND_LABEL[group.kind]} ${PLAN_LABEL[group.plan]}`,
          collectedCents: group.collectedCents,
          revenuePerPoint: group.revenuePerPoint,
          points: group.points,
        })),
        maxWorkDays: subject.maxWorkDays,
      });
    } else if (formula === "manager") {
      salary = rules.manager({
        role: subject.role as "head" | "deputy-head",
        points: subject.points,
        teamPoints: staffByDepartment.get(subject.departmentId!) ?? [],
        workDays: mealWorkDaysOf(formula, subject, userDays, departmentDays),
        departmentQuota: quota.department(subject.departmentId!),
        casaAccounts: quota.casa(subject.id),
        maxWorkDays: subject.maxWorkDays,
        mealDays,
      });
    } else if (formula === "deputy-director") {
      salary = rules.deputyDirector!({
        teamPoints: managed.flatMap((departmentId) => staffByDepartment.get(departmentId) ?? []),
        members: managed.flatMap((departmentId) =>
          (reachByDepartment.get(departmentId) ?? []).map((member) => ({
            ...member,
            share: shareOf(departmentId),
          })),
        ),
        branchPoints: managed.reduce(
          (sum, departmentId) =>
            sum + (branchPointsByDepartment.get(departmentId) ?? 0) * shareOf(departmentId),
          0,
        ),
        departmentQuotas: managed.flatMap((departmentId) => {
          const progress = quota.department(departmentId);
          return progress ? [{ ...progress, share: shareOf(departmentId) }] : [];
        }),
        sharedDepartments: managed
          .filter((departmentId) => shareOf(departmentId) < 1)
          .map((departmentId) => ({
            name: salesDepartmentName.get(departmentId)!,
            deputyDirectors: deputyDirectorsByDepartment.get(departmentId)!,
            points: branchPointsByDepartment.get(departmentId) ?? 0,
            members: reachByDepartment.get(departmentId) ?? [],
          })),
        mealDays,
      });
    }

    if (salary)
      result.set(subject.id, {
        amount: salary.amount,
        pointsAmount: salary.amount,
        month: yearMonth,
        facts: salary.facts,
        items: nonZeroItems(salary.items),
        revenue: salary.revenue,
        adjustments: [],
      });
  }

  return result;
}

/**
 * Chỉ tiêu và số đã đạt của tháng; tháng chưa lưu dùng tháng gần nhất trước đó.
 * Chưa có tháng nào, hoặc mục chưa chọn loại tài khoản nào, thì trả `null`:
 * không chấm, không cộng không trừ.
 *
 * Nhân viên chỉ chấm khi là HĐLĐ (chốt 2026-09-25); đếm theo người lập hồ sơ
 * khách như KPI. Phòng đếm MỌI tài khoản ghi nhận cho phòng, không riêng HĐLĐ.
 *
 * `casa` là số tài khoản CASA của nhân viên HĐLĐ và của Trưởng/Phó phòng tự mở.
 * CASA không cần chỉ tiêu tháng: chỉ tiêu CASA cá nhân chỉ lưu.
 */
export async function quotaProgressFor(
  yearMonth: string,
  subjects: Pick<Subject, "id" | "role" | "contractType" | "departmentId" | "departmentCode" | "departmentType">[],
  managedRows: { departmentId: string; departmentCode: string }[],
): Promise<{
  staff: (userId: string) => QuotaProgress | null;
  department: (departmentId: string) => DepartmentQuotaProgress | null;
  casa: (userId: string) => number;
}> {
  const casaUserIds = subjects
    .filter(
      (s) =>
        s.departmentType === "sales" &&
        ((s.role === "staff" && s.contractType === "hdld") ||
          s.role === "head" ||
          s.role === "deputy-head"),
    )
    .map((s) => s.id);
  const casaByUser = await countCasaAccounts(yearMonth, "creator", casaUserIds);
  const casa = (userId: string) => casaByUser.get(userId) ?? 0;

  const none = { staff: () => null, department: () => null, casa };
  // File CASA tháng M-1 tính vào lương tháng M, nên chấm theo chỉ tiêu CASA tháng M-1 (chốt 2026-11-17).
  const casaMonth = shiftMonth(yearMonth, -1);
  const [config, casaConfig] = await Promise.all([quotaConfigOf(yearMonth), quotaConfigOf(casaMonth)]);
  if (!config) return none;

  const needsDepartmentQuota = salaryRulesFor(yearMonth)?.staffQuotaNeedsDepartmentQuota ?? false;
  const staffIds =
    config.staffDirected && config.directedKinds.length > 0
      ? subjects
          .filter((s) => s.role === "staff" && s.departmentType === "sales" && s.contractType === "hdld")
          .filter(
            (s) =>
              !needsDepartmentQuota ||
              (s.departmentId !== null && Boolean(config.departments.get(s.departmentId)?.directed)),
          )
          .map((s) => s.id)
      : [];
  const departmentIds = [
    ...new Set([
      ...subjects
        .filter((s) => (s.role === "head" || s.role === "deputy-head") && s.departmentId)
        .map((s) => s.departmentId!),
      ...managedRows.map((row) => row.departmentId),
    ]),
  ].filter((id) => config.departments.has(id) || casaConfig?.departments.has(id));

  const [directedByStaff, hkdByDepartment, directedByDepartment, casaByDepartment] = await Promise.all([
    countQuotaAccounts(yearMonth, config.directedKinds, "creator", staffIds),
    countQuotaAccounts(yearMonth, config.hkdKinds, "department", departmentIds),
    countQuotaAccounts(yearMonth, config.directedKinds, "department", departmentIds),
    countCasaAccounts(yearMonth, "department", departmentIds),
  ]);

  const codeOfDepartment = new Map<string, string | null>([
    ...subjects.flatMap((s) => (s.departmentId ? [[s.departmentId, s.departmentCode] as const] : [])),
    ...managedRows.map((row) => [row.departmentId, row.departmentCode] as const),
  ]);

  const progress = (
    target: number | null,
    kindsCount: number,
    achieved: number | undefined,
    departmentCode: string | null,
  ): QuotaProgress | null =>
    target && kindsCount > 0
      ? { target: quotaTargetFor(yearMonth, target, departmentCode), achieved: achieved ?? 0 }
      : null;

  return {
    // Không truyền mã phòng: chỉ tiêu cá nhân chấm đủ số, kể cả Phòng Y và Dự án.
    staff: (userId) =>
      staffIds.includes(userId)
        ? progress(config.staffDirected, config.directedKinds.length, directedByStaff.get(userId), null)
        : null,
    department: (departmentId) => {
      const targets = config.departments.get(departmentId);
      const casaTarget = casaConfig?.departments.get(departmentId)?.casa ?? null;
      if (!targets && !casaTarget) return null;
      const code = codeOfDepartment.get(departmentId) ?? null;
      const hkd = progress(
        targets?.hkd ?? null,
        config.hkdKinds.length,
        hkdByDepartment.get(departmentId),
        code,
      );
      const directed = progress(
        targets?.directed ?? null,
        config.directedKinds.length,
        directedByDepartment.get(departmentId),
        code,
      );
      // CASA không có danh sách loại tài khoản: file CASA đã chỉ rõ từng tài khoản.
      const casaQuota: QuotaProgress | null = casaTarget
        ? {
            target: quotaTargetFor(casaMonth, casaTarget, code),
            achieved: casaByDepartment.get(departmentId) ?? 0,
          }
        : null;
      return hkd || directed || casaQuota ? { hkd, directed, casa: casaQuota } : null;
    },
    casa,
  };
}

/* ── Chốt lương theo tháng ─────────────────────────────────────────────── */

export type SalaryClosingStatus = {
  month: string;
  closed: boolean;
  closable: boolean;
  /** Vì sao chưa chốt được, hiện ở tooltip của nút mờ. `null` khi chốt được hoặc đã chốt. */
  blockedReason: string | null;
  closedAt: string | null;
  closedByName: string | null;
};

const monthText = (yearMonth: string) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return `tháng ${month}/${year}`;
};

/** Ngày đầu tháng kế tiếp, dạng 01/MM/YYYY. */
const firstDayAfter = (yearMonth: string) => {
  const [year, month] = yearMonth.split("-").map(Number);
  const [nextYear, nextMonth] = month === 12 ? [year + 1, 1] : [year, month + 1];
  return `01/${String(nextMonth).padStart(2, "0")}/${nextYear}`;
};

/**
 * Tháng còn yêu cầu tạm ứng chưa chi xong thì không chốt lương: chốt rồi thì
 * nút Đã chi tạm ứng bị khoá, khoản đã chuyển tiền không bao giờ trừ vào lương.
 * Khoản ứng trừ vào lương tháng liền trước, nên đọc yêu cầu của tháng liền sau.
 */
async function unsettledAdvanceReason(conn: Pick<typeof db, "select">, yearMonth: string): Promise<string | null> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(salaryAdvanceRequests)
    .where(
      and(
        eq(salaryAdvanceRequests.yearMonth, shiftMonth(yearMonth, 1)),
        inArray(salaryAdvanceRequests.status, ["head-approved", "approved", "processing"]),
      ),
    );
  return row && row.n > 0
    ? `Lương ${monthText(yearMonth)} còn ${row.n} yêu cầu tạm ứng chưa chi xong, không chốt được.`
    : null;
}

/** Chốt rồi thì nút Đã chi ăn ca bị khoá, lương tháng trả ăn ca lần nữa. Ăn ca tháng M trừ vào chính lương tháng M. */
async function unsettledMealReason(conn: Pick<typeof db, "select">, yearMonth: string): Promise<string | null> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(mealAllowanceRows)
    .where(
      and(
        eq(mealAllowanceRows.yearMonth, yearMonth),
        inArray(mealAllowanceRows.status, ["pending", "head-approved", "forwarded", "approved", "processing"]),
      ),
    );
  return row && row.n > 0
    ? `Lương ${monthText(yearMonth)} còn ${row.n} dòng ăn ca chưa chi xong, không chốt được.`
    : null;
}

function blockedReasonOf(yearMonth: string): string | null {
  if (yearMonth >= businessMonth())
    return `Lương ${monthText(yearMonth)} chốt được từ ngày ${firstDayAfter(yearMonth)}, khi tháng đã kết thúc.`;
  if (!salaryRulesFor(yearMonth))
    return `Lương ${monthText(yearMonth)} chưa có công thức tính, không chốt được.`;
  return null;
}

export async function salaryClosingOf(yearMonth: string): Promise<SalaryClosingStatus> {
  const [row] = await db
    .select({ closedAt: salaryClosings.closedAt, closedByName: users.fullName })
    .from(salaryClosings)
    .innerJoin(users, eq(users.id, salaryClosings.closedBy))
    .where(eq(salaryClosings.yearMonth, yearMonth))
    .limit(1);
  // Tháng chưa kết thúc thì điểm và ngày công còn tăng. Tháng chưa có công
  // thức thì không có số nào để chốt. Tính ở máy chủ vì tháng hiện tại theo
  // giờ Việt Nam, máy người dùng để múi giờ khác thì ra tháng khác.
  const blockedReason = row
    ? null
    : (blockedReasonOf(yearMonth) ??
      (await unsettledAdvanceReason(db, yearMonth)) ??
      (await unsettledMealReason(db, yearMonth)));
  return {
    month: yearMonth,
    closed: Boolean(row),
    closable: !row && blockedReason === null,
    blockedReason,
    closedAt: row?.closedAt.toISOString() ?? null,
    closedByName: row?.closedByName ?? null,
  };
}

/**
 * Chốt lương một tháng: tính lương mọi người theo dữ liệu lúc bấm rồi lưu lại.
 * Trả `null` khi tháng đó đã chốt. Không có đường mở chốt (chủ dự án chốt
 * 2026-09-23): số đã chốt là số đã trả.
 *
 * Lấy cả người đã nghỉ: họ vẫn có lương của tháng họ còn làm. Chỉ lưu dòng có
 * công thức; người không có dòng đọc ra lương 0, giống lúc chưa chốt.
 */
export async function closeSalaryMonth(actor: User, yearMonth: string): Promise<number | null | string> {
  return db.transaction(async (tx) => {
    // Tính lương SAU khi giữ khoá: Đã chi tạm ứng phải chờ, không chen vào giữa lúc tính và lúc lưu bản chụp.
    await lockSalaryMonth(tx, yearMonth);
    const unsettled = (await unsettledAdvanceReason(tx, yearMonth)) ?? (await unsettledMealReason(tx, yearMonth));
    if (unsettled) return unsettled;

    const everyone = await db.select({ id: users.id }).from(users);
    const ids = everyone.map((row) => row.id);
    const salaries = await withAdjustments(await liveSalaries(ids, yearMonth), ids, yearMonth);
    // Người chưa có công thức lương mà có khoản ứng, thưởng, trừ vẫn phải có bản chụp.
    const snapshots = [...salaries]
      .filter(([, salary]) => salary.items.length > 0 || salary.adjustments.length > 0)
      .map(([userId, salary]) => ({
        yearMonth,
        userId,
        amount: salary.amount,
        breakdown: {
          facts: salary.facts,
          items: salary.items,
          revenue: salary.revenue,
          pointsAmount: salary.pointsAmount,
          adjustments: salary.adjustments,
        },
      }));

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

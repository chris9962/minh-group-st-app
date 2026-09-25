import { and, eq, inArray, sql } from "drizzle-orm";
import { businessMonth, monthRange } from "@/lib/format";
import type { ContractType, RoleKey, User } from "@/lib/types";
import {
  salaryRulesFor,
  type DepartmentQuotaProgress,
  type QuotaProgress,
  type SalaryFact,
  type SalaryItem,
} from "@/rules/salary";
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
import { countQuotaAccounts, quotaConfigOf } from "./quota";

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
  contractType: ContractType | null;
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
  if (rows.length === 0) return liveSalaries(userIds, yearMonth);

  const result = new Map<string, SalaryBreakdown>();
  for (const id of userIds) result.set(id, zeroSalary(yearMonth));
  for (const row of rows)
    if (row.userId && row.amount !== null && row.breakdown)
      result.set(row.userId, { amount: row.amount, month: yearMonth, ...row.breakdown });
  return result;
}

/**
 * Lương CĐS đang chạy, tính theo file kỳ ở `src/rules/salary`.
 *
 * Chỉ tiêu QĐ 145 đọc từ màn Chỉ tiêu tháng, xem `quotaProgressFor`.
 * TODO(lương CĐS, file mẫu CASA của Yên): chưa đếm CASA, nên chưa truyền chỉ
 * tiêu CASA vào file kỳ. Gỡ khi có màn nhập danh sách CASA.
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
      contractType: users.contractType,
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

  const quota = await quotaProgressFor(yearMonth, subjects, managedRows);

  for (const subject of subjects) {
    let salary = null;

    if (subject.role === "staff" && subject.departmentType === "sales") {
      salary = rules.staff({
        points: subject.points,
        workDays: userDays.get(subject.id) ?? 0,
        directedQuota: quota.staff(subject.id),
      });
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
        departmentQuota: quota.department(subject.departmentId),
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
          departmentQuotas: managed.flatMap((departmentId) => {
            const progress = quota.department(departmentId);
            return progress ? [progress] : [];
          }),
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

/**
 * Chỉ tiêu và số đã đạt của tháng; tháng chưa lưu dùng tháng gần nhất trước đó.
 * Chưa có tháng nào, hoặc mục chưa chọn loại tài khoản nào, thì trả `null`:
 * không chấm, không cộng không trừ.
 *
 * Nhân viên chỉ chấm khi là HĐLĐ (chốt 2026-09-25); đếm theo người lập hồ sơ
 * khách như KPI. Phòng đếm MỌI tài khoản ghi nhận cho phòng, không riêng HĐLĐ.
 */
async function quotaProgressFor(
  yearMonth: string,
  subjects: Subject[],
  managedRows: { departmentId: string }[],
): Promise<{
  staff: (userId: string) => QuotaProgress | null;
  department: (departmentId: string) => DepartmentQuotaProgress | null;
}> {
  const none = { staff: () => null, department: () => null };
  const config = await quotaConfigOf(yearMonth);
  if (!config) return none;

  const staffIds =
    config.staffDirected && config.directedKinds.length > 0
      ? subjects
          .filter((s) => s.role === "staff" && s.departmentType === "sales" && s.contractType === "hdld")
          .map((s) => s.id)
      : [];
  const departmentIds = [
    ...new Set([
      ...subjects
        .filter((s) => (s.role === "head" || s.role === "deputy-head") && s.departmentId)
        .map((s) => s.departmentId!),
      ...managedRows.map((row) => row.departmentId),
    ]),
  ].filter((id) => config.departments.has(id));

  const [directedByStaff, hkdByDepartment, directedByDepartment] = await Promise.all([
    countQuotaAccounts(yearMonth, config.directedKinds, "creator", staffIds),
    countQuotaAccounts(yearMonth, config.hkdKinds, "department", departmentIds),
    countQuotaAccounts(yearMonth, config.directedKinds, "department", departmentIds),
  ]);

  const progress = (
    target: number | null,
    kindsCount: number,
    achieved: number | undefined,
  ): QuotaProgress | null =>
    target && kindsCount > 0 ? { target, achieved: achieved ?? 0 } : null;

  return {
    staff: (userId) =>
      staffIds.includes(userId)
        ? progress(config.staffDirected, config.directedKinds.length, directedByStaff.get(userId))
        : null,
    department: (departmentId) => {
      const targets = config.departments.get(departmentId);
      if (!targets) return null;
      const hkd = progress(targets.hkd, config.hkdKinds.length, hkdByDepartment.get(departmentId));
      const directed = progress(
        targets.directed,
        config.directedKinds.length,
        directedByDepartment.get(departmentId),
      );
      return hkd || directed ? { hkd, directed } : null;
    },
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
  const blockedReason = row ? null : blockedReasonOf(yearMonth);
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

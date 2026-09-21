import { and, eq, inArray, sql } from "drizzle-orm";
import { monthRange, roundPoints } from "@/lib/format";
import type { RoleKey } from "@/lib/types";
import { db } from "./db/client";
import {
  departments,
  employeeWorkDays,
  kpiAdjustments,
  kpiScores,
  userManagedDepartments,
  users,
} from "./db/schema";

const DAILY_SUPPORT = 120_000;
const STAFF_FIRST_TIER_RATE = 60_000;
const SALES_MAX_DAYS = 26;
const DEPUTY_DIRECTOR_DAYS = 22;

export type SalaryBreakdown = {
  amount: number;
  directPoints: number;
  managementPoints: number;
  workDays: number;
  items: Array<{ label: string; formula: string; amount: number }>;
};

const ZERO_SALARY: SalaryBreakdown = {
  amount: 0,
  directPoints: 0,
  managementPoints: 0,
  workDays: 0,
  items: [],
};

/** Thưởng vượt của nhân viên, lũy tiến theo ba bậc 101–130, 131–160, >160. */
export function staffOverTargetBonus(points: number): number {
  return (
    70_000 * Math.min(Math.max(points - 100, 0), 30) +
    80_000 * Math.min(Math.max(points - 130, 0), 30) +
    90_000 * Math.max(points - 160, 0)
  );
}

/** 100 điểm đầu trả 60.000đ/điểm, tối đa 6 triệu; không phải lương cố định. */
export function staffFirstTierPay(points: number): number {
  return STAFF_FIRST_TIER_RATE * Math.min(Math.max(points, 0), 100);
}

/** Quỹ thưởng quản lý theo điểm trung bình phòng, cùng ba bậc nhưng đơn giá 7/8/9 nghìn. */
export function departmentManagementPool(averagePoints: number, overTargetStaff: number): number {
  if (overTargetStaff === 0) return 0;
  const perStaff =
    7_000 * Math.min(Math.max(averagePoints - 100, 0), 30) +
    8_000 * Math.min(Math.max(averagePoints - 130, 0), 30) +
    9_000 * Math.max(averagePoints - 160, 0);
  return perStaff * overTargetStaff;
}

/** Thưởng PGĐ theo tổng điểm các phòng phụ trách, tính lũy tiến. */
export function deputyDirectorBranchBonus(points: number): number {
  return (
    2_000 * Math.min(Math.max(points, 0), 10_000) +
    3_000 * Math.min(Math.max(points - 10_000, 0), 5_000) +
    4_000 * Math.max(points - 15_000, 0)
  );
}

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

type StaffScore = { id: string; departmentId: string; points: number };

/**
 * Lương CĐS đang chạy, chưa phải ảnh chụp đã chốt.
 *
 * CASA và tài khoản định hướng đang bằng 0 theo chốt nghiệp vụ. Thành phần HKD
 * của cấp quản lý cũng chưa cộng vì database mới có sản lượng, chưa có chỉ tiêu
 * HKD theo phòng/tháng để quyết định đạt hay thiếu bao nhiêu phần trăm.
 */
export async function salaryForUsers(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SalaryBreakdown>> {
  const result = new Map<string, SalaryBreakdown>();
  for (const id of userIds) result.set(id, ZERO_SALARY);
  if (userIds.length === 0) return result;

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

  const staffScores: StaffScore[] = relevantDepartmentIds.length
    ? await db
        .select({ id: users.id, departmentId: users.departmentId, points })
        .from(users)
        .leftJoin(
          kpiScores,
          and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, yearMonth)),
        )
        .where(
          and(
            eq(users.role, "staff"),
            eq(users.active, true),
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
  const staffByDepartment = new Map<string, StaffScore[]>();
  for (const staff of staffScores) {
    const kept = staffByDepartment.get(staff.departmentId);
    if (kept) kept.push(staff);
    else staffByDepartment.set(staff.departmentId, [staff]);
  }

  for (const subject of subjects) {
    const directPoints = roundPoints(subject.points);

    if (subject.role === "staff") {
      if (subject.departmentType !== "sales") continue;
      const workDays = Math.min(userDays.get(subject.id) ?? 0, SALES_MAX_DAYS);
      const firstTierPoints = Math.min(Math.max(directPoints, 0), 100);
      const secondTierPoints = Math.min(Math.max(directPoints - 100, 0), 30);
      const thirdTierPoints = Math.min(Math.max(directPoints - 130, 0), 30);
      const fourthTierPoints = Math.max(directPoints - 160, 0);
      const firstTierPay = staffFirstTierPay(directPoints);
      const secondTierPay = secondTierPoints * 70_000;
      const thirdTierPay = thirdTierPoints * 80_000;
      const fourthTierPay = fourthTierPoints * 90_000;
      const overTargetBonus = staffOverTargetBonus(directPoints);
      const dailySupport = workDays * DAILY_SUPPORT;
      result.set(subject.id, {
        amount: Math.max(
          0,
          Math.round(firstTierPay + overTargetBonus + dailySupport),
        ),
        directPoints,
        managementPoints: 0,
        workDays,
        items: [
          {
            label: "KPI bậc 1 · 0–100 điểm",
            formula: `${firstTierPoints} điểm × 60.000đ`,
            amount: firstTierPay,
          },
          {
            label: "KPI bậc 2 · 101–130 điểm",
            formula: `${secondTierPoints} điểm × 70.000đ`,
            amount: secondTierPay,
          },
          {
            label: "KPI bậc 3 · 131–160 điểm",
            formula: `${thirdTierPoints} điểm × 80.000đ`,
            amount: thirdTierPay,
          },
          {
            label: "KPI bậc 4 · trên 160 điểm",
            formula: `${fourthTierPoints} điểm × 90.000đ`,
            amount: fourthTierPay,
          },
          {
            label: "Trợ cấp ngày công",
            formula: `${workDays} ngày × 120.000đ`,
            amount: dailySupport,
          },
        ],
      });
      continue;
    }

    if (subject.role === "head" || subject.role === "deputy-head") {
      if (subject.departmentType !== "sales" || !subject.departmentId) continue;
      const team = staffByDepartment.get(subject.departmentId) ?? [];
      const reached = team.filter((staff) => staff.points >= 100).length;
      const below = team.length - reached;
      const allOver = team.length > 0 && team.every((staff) => staff.points > 100);
      const unit = subject.role === "head" ? 9 : 6;
      const managementPoints = unit * reached - unit * below + (allOver ? unit : 0);
      const average = team.length === 0
        ? 0
        : team.reduce((sum, staff) => sum + staff.points, 0) / team.length;
      const overTargetStaff = team.filter((staff) => staff.points > 100).length;
      const pool = departmentManagementPool(average, overTargetStaff);
      const poolShare = subject.role === "head" ? 0.7 : 0.3;
      const workDays = Math.min(
        departmentDays.get(subject.departmentId) ?? 0,
        SALES_MAX_DAYS,
      );
      const managementRate = subject.role === "head" ? 120_000 : 80_000;
      const managementPay = managementPoints * managementRate;
      const directPay = Math.max(directPoints, 0) * 70_000;
      const poolPay = pool * poolShare;
      const dailySupport = workDays * DAILY_SUPPORT;
      const subtotal = managementPay + directPay + poolPay + dailySupport;
      const floorAdjustment = Math.max(0, -subtotal);
      result.set(subject.id, {
        amount: Math.max(0, Math.round(subtotal)),
        directPoints,
        managementPoints,
        workDays,
        items: [
          {
            label: "Điểm quản lý",
            formula: `${managementPoints} điểm × ${managementRate.toLocaleString("vi-VN")}đ`,
            amount: managementPay,
          },
          {
            label: "Điểm trực tiếp",
            formula: `${Math.max(directPoints, 0)} điểm × 70.000đ`,
            amount: directPay,
          },
          {
            label: "Quỹ thưởng phòng",
            formula: `${subject.role === "head" ? "70%" : "30%"} quỹ của phòng`,
            amount: poolPay,
          },
          {
            label: "Trợ cấp ngày công",
            formula: `${workDays} ngày × 120.000đ`,
            amount: dailySupport,
          },
          ...(floorAdjustment > 0
            ? [{ label: "Điều chỉnh tối thiểu", formula: "Lương không âm", amount: floorAdjustment }]
            : []),
        ],
      });
      continue;
    }

    if (subject.role === "deputy-director") {
      const managed = managedByUser.get(subject.id) ?? [];
      if (managed.length === 0) continue;
      const team = managed.flatMap((departmentId) => staffByDepartment.get(departmentId) ?? []);
      const reached = team.filter((staff) => staff.points >= 100).length;
      const totalPoints = team.reduce((sum, staff) => sum + staff.points, 0);
      const managementPoints = 3 * reached;
      const managementPay = managementPoints * 150_000;
      const branchBonus = deputyDirectorBranchBonus(totalPoints);
      const dailySupport = DEPUTY_DIRECTOR_DAYS * DAILY_SUPPORT;
      result.set(subject.id, {
        amount: Math.max(0, Math.round(managementPay + branchBonus + dailySupport)),
        directPoints,
        managementPoints,
        workDays: DEPUTY_DIRECTOR_DAYS,
        items: [
          {
            label: "Điểm quản lý",
            formula: `${managementPoints} điểm × 150.000đ`,
            amount: managementPay,
          },
          {
            label: "Thưởng tổng điểm chi nhánh",
            formula: `${roundPoints(totalPoints)} điểm · tính lũy tiến`,
            amount: branchBonus,
          },
          {
            label: "Trợ cấp ngày công",
            formula: `${DEPUTY_DIRECTOR_DAYS} ngày × 120.000đ`,
            amount: dailySupport,
          },
        ],
      });
    }
  }

  return result;
}

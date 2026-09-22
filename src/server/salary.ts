import { and, eq, inArray, sql } from "drizzle-orm";
import { formatPoints, monthRange, roundPoints } from "@/lib/format";
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
const MANAGEMENT_PENALTY_LAST_MONTH = "2026-07";
/**
 * Chú thích 12, 16, 19 của quy chế 107: "Làm trực tiếp" của Trưởng/Phó phòng
 * và toàn bộ bảng KPI + thưởng nhánh của Phó GĐ áp dụng từ tháng 8/2026.
 */
const DIRECT_AND_DEPUTY_FIRST_MONTH = "2026-08";

type SalaryItem = { label: string; formula: string; amount: number };

export type SalaryBreakdown = {
  amount: number;
  month: string;
  facts: Array<{ label: string; value: string }>;
  items: SalaryItem[];
};

const zeroSalary = (month: string): SalaryBreakdown => ({
  amount: 0,
  month,
  facts: [],
  items: [],
});

const vnd = (amount: number) => `${amount.toLocaleString("vi-VN")}đ`;

/**
 * Bỏ khoản bằng 0 cho gọn, nhưng giữ khoản đầu khi mọi khoản đều 0: danh sách
 * rỗng là dấu hiệu "chưa có công thức", không phải "lương 0".
 */
const nonZeroItems = (items: SalaryItem[]): SalaryItem[] => {
  const rounded = items.map((item) => ({ ...item, amount: Math.round(item.amount) }));
  const kept = rounded.filter((item) => item.amount !== 0);
  return kept.length > 0 ? kept : rounded.slice(0, 1);
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

type StaffScore = {
  id: string;
  departmentId: string;
  role: RoleKey;
  active: boolean;
  points: number;
};

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
  for (const id of userIds) result.set(id, zeroSalary(yearMonth));
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

  /**
   * Kéo cả Phó phòng và người đã nghỉ: "Tổng điểm nhánh" của PGĐ phải khớp tổng
   * điểm phòng ở màn Tổng quan (chốt 2026-09-22), mà màn đó cộng mọi người có
   * điểm trong tháng. Các phép đếm theo ĐẦU NGƯỜI bên dưới vẫn chỉ lấy nhân
   * viên đang làm, lọc ở `activeStaffByDepartment`.
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
  const staffByDepartment = new Map<string, StaffScore[]>();
  const branchPointsByDepartment = new Map<string, number>();
  for (const row of scoreRows) {
    branchPointsByDepartment.set(
      row.departmentId,
      (branchPointsByDepartment.get(row.departmentId) ?? 0) + row.points,
    );
    if (row.role !== "staff" || !row.active) continue;
    const kept = staffByDepartment.get(row.departmentId);
    if (kept) kept.push(row);
    else staffByDepartment.set(row.departmentId, [row]);
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
        month: yearMonth,
        facts: [
          { label: "Điểm KPI", value: `${formatPoints(directPoints)} điểm` },
          { label: "Ngày công", value: `${workDays} ngày` },
        ],
        // Tên khoản theo đúng chữ trong quy chế 107/108 để người đọc đối chiếu được.
        items: nonZeroItems([
          {
            label: "Lương tiêu chuẩn",
            formula: `${formatPoints(firstTierPoints)} điểm × 60.000đ`,
            amount: firstTierPay,
          },
          {
            label: "Thưởng vượt mốc 1",
            formula: `${formatPoints(secondTierPoints)} điểm × 70.000đ`,
            amount: secondTierPay,
          },
          {
            label: "Thưởng vượt mốc 2",
            formula: `${formatPoints(thirdTierPoints)} điểm × 80.000đ`,
            amount: thirdTierPay,
          },
          {
            label: "Thưởng vượt mốc 3",
            formula: `${formatPoints(fourthTierPoints)} điểm × 90.000đ`,
            amount: fourthTierPay,
          },
          {
            label: "Hỗ trợ ăn ca",
            formula: `${workDays} ngày × 120.000đ`,
            amount: dailySupport,
          },
        ]),
      });
      continue;
    }

    if (subject.role === "head" || subject.role === "deputy-head") {
      if (subject.departmentType !== "sales" || !subject.departmentId) continue;
      const team = staffByDepartment.get(subject.departmentId) ?? [];
      const reached = team.filter((staff) => staff.points >= 100).length;
      // Chú thích cuối trang của Phụ lục 05 (quy chế 107): trừ "nhân sự dưới
      // 100 điểm" và cộng "cả phòng vượt 100" chỉ áp dụng đến hết tháng 7/2026.
      // Bản .md của quy chế bỏ mất chú thích, phải đọc file .docx mới thấy.
      const penaltyActive = yearMonth <= MANAGEMENT_PENALTY_LAST_MONTH;
      const below = penaltyActive ? team.length - reached : 0;
      const allOver = penaltyActive && team.length > 0 && team.every((staff) => staff.points > 100);
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
      const directPay =
        yearMonth >= DIRECT_AND_DEPUTY_FIRST_MONTH ? Math.max(directPoints, 0) * 70_000 : 0;
      const poolPay = pool * poolShare;
      const dailySupport = workDays * DAILY_SUPPORT;
      const subtotal = managementPay + directPay + poolPay + dailySupport;
      const floorAdjustment = Math.max(0, -subtotal);
      result.set(subject.id, {
        amount: Math.max(0, Math.round(subtotal)),
        month: yearMonth,
        facts: [
          { label: "Điểm KPI", value: `${formatPoints(directPoints)} điểm` },
          { label: "Điểm quản lý", value: `${formatPoints(managementPoints)} điểm` },
          { label: "Nhân viên trong phòng", value: `${team.length} người` },
          { label: "Ngày công", value: `${workDays} ngày` },
        ],
        // Điểm quản lý tách từng dòng theo số người, vì một con số gộp như
        // "27 điểm" không cho Trưởng phòng tự kiểm được ai đạt, ai chưa.
        items: nonZeroItems([
          {
            label: "Nhân viên đạt 100 điểm",
            formula: `${reached} người × ${unit} điểm × ${vnd(managementRate)}`,
            amount: reached * unit * managementRate,
          },
          {
            label: "Nhân viên dưới 100 điểm",
            formula: `${below} người × -${unit} điểm × ${vnd(managementRate)}`,
            amount: -below * unit * managementRate,
          },
          {
            label: "Cả phòng vượt 100 điểm",
            formula: `${unit} điểm × ${vnd(managementRate)}`,
            amount: allOver ? unit * managementRate : 0,
          },
          {
            label: "Làm trực tiếp",
            formula: `${formatPoints(Math.max(directPoints, 0))} điểm × 70.000đ`,
            amount: directPay,
          },
          {
            label: "Thưởng vượt của phòng",
            formula: `Trung bình ${formatPoints(roundPoints(average))} điểm - ${overTargetStaff} người vượt - ${subject.role === "head" ? "70%" : "30%"} quỹ`,
            amount: poolPay,
          },
          {
            label: "Hỗ trợ ăn ca",
            formula: `${workDays} ngày × 120.000đ`,
            amount: dailySupport,
          },
          {
            label: "Điều chỉnh tối thiểu",
            formula: "Lương không âm",
            amount: floorAdjustment,
          },
        ]),
      });
      continue;
    }

    if (subject.role === "deputy-director") {
      if (yearMonth < DIRECT_AND_DEPUTY_FIRST_MONTH) continue;
      const managed = managedByUser.get(subject.id) ?? [];
      if (managed.length === 0) continue;
      const team = managed.flatMap((departmentId) => staffByDepartment.get(departmentId) ?? []);
      const reached = team.filter((staff) => staff.points >= 100).length;
      const totalPoints = managed.reduce(
        (sum, departmentId) => sum + (branchPointsByDepartment.get(departmentId) ?? 0),
        0,
      );
      const managementPoints = 3 * reached;
      const managementPay = managementPoints * 150_000;
      const branchBonus = deputyDirectorBranchBonus(totalPoints);
      // Ba bậc của thưởng nhánh, cùng mốc với `deputyDirectorBranchBonus`.
      const branchTier1 = roundPoints(Math.min(Math.max(totalPoints, 0), 10_000));
      const branchTier2 = roundPoints(Math.min(Math.max(totalPoints - 10_000, 0), 5_000));
      const branchTier3 = roundPoints(Math.max(totalPoints - 15_000, 0));
      const dailySupport = DEPUTY_DIRECTOR_DAYS * DAILY_SUPPORT;
      result.set(subject.id, {
        amount: Math.max(0, Math.round(managementPay + branchBonus + dailySupport)),
        month: yearMonth,
        facts: [
          { label: "Điểm quản lý", value: `${formatPoints(managementPoints)} điểm` },
          { label: "Nhân viên các phòng phụ trách", value: `${team.length} người` },
          { label: "Tổng điểm nhánh", value: `${formatPoints(roundPoints(totalPoints))} điểm` },
          { label: "Ngày công", value: `${DEPUTY_DIRECTOR_DAYS} ngày` },
        ],
        items: nonZeroItems([
          {
            label: "Nhân viên đạt 100 điểm",
            formula: `${reached} người × 3 điểm × 150.000đ`,
            amount: managementPay,
          },
          {
            label: "Thưởng nhánh mốc 1",
            formula: `${formatPoints(branchTier1)} điểm × 2.000đ`,
            amount: branchTier1 * 2_000,
          },
          {
            label: "Thưởng nhánh mốc 2",
            formula: `${formatPoints(branchTier2)} điểm × 3.000đ`,
            amount: branchTier2 * 3_000,
          },
          {
            label: "Thưởng nhánh mốc 3",
            formula: `${formatPoints(branchTier3)} điểm × 4.000đ`,
            amount: branchTier3 * 4_000,
          },
          {
            label: "Hỗ trợ ăn ca",
            formula: `${DEPUTY_DIRECTOR_DAYS} ngày × 120.000đ`,
            amount: dailySupport,
          },
        ]),
      });
    }
  }

  return result;
}

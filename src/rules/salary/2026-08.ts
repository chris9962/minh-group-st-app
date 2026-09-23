import { formatPoints, roundPoints } from "@/lib/format";
import type {
  DeputyDirectorSalaryInput,
  ManagerSalaryInput,
  SalaryItem,
  SalaryResult,
  StaffSalaryInput,
} from "./index";

/**
 * Lương CĐS từ tháng 2026-08, theo chú thích cuối trang của quy chế 107/108.
 *
 * Khác kỳ 2026-07: Trưởng/Phó phòng bỏ trừ điểm nhân viên dưới 100 và bỏ cộng
 * cả phòng vượt 100 (chú thích 7, 8), thêm "Làm trực tiếp" 70.000đ/điểm (chú
 * thích 12); có bảng lương Phó GĐ (chú thích 16, 19).
 *
 * Chưa tính: HKD của quản lý, tài khoản định hướng, CASA (áp dụng từ 2026-09).
 * Database chưa có chỉ tiêu theo phòng/tháng để biết đạt hay thiếu bao nhiêu.
 */

const DAILY_SUPPORT = 120_000;
const MAX_DAYS = 26;
const DEPUTY_DIRECTOR_DAYS = 22;

const vnd = (amount: number) => `${amount.toLocaleString("vi-VN")}đ`;
const total = (items: SalaryItem[]) => items.reduce((sum, item) => sum + item.amount, 0);

export function staff({ points, workDays }: StaffSalaryInput): SalaryResult {
  const direct = roundPoints(points);
  const days = Math.min(workDays, MAX_DAYS);
  const tier1 = Math.min(Math.max(direct, 0), 100);
  const tier2 = Math.min(Math.max(direct - 100, 0), 30);
  const tier3 = Math.min(Math.max(direct - 130, 0), 30);
  const tier4 = Math.max(direct - 160, 0);
  const items: SalaryItem[] = [
    { label: "Lương tiêu chuẩn", formula: `${formatPoints(tier1)} điểm × 60.000đ`, amount: tier1 * 60_000 },
    { label: "Thưởng vượt mốc 1", formula: `${formatPoints(tier2)} điểm × 70.000đ`, amount: tier2 * 70_000 },
    { label: "Thưởng vượt mốc 2", formula: `${formatPoints(tier3)} điểm × 80.000đ`, amount: tier3 * 80_000 },
    { label: "Thưởng vượt mốc 3", formula: `${formatPoints(tier4)} điểm × 90.000đ`, amount: tier4 * 90_000 },
    { label: "Hỗ trợ ăn ca", formula: `${days} ngày × 120.000đ`, amount: days * DAILY_SUPPORT },
  ];
  return {
    amount: Math.max(0, Math.round(total(items))),
    facts: [
      { label: "Điểm KPI", value: `${formatPoints(direct)} điểm` },
      { label: "Ngày công", value: `${days} ngày` },
    ],
    items,
  };
}

/** Quỹ thưởng vượt của phòng theo điểm trung bình, lũy tiến 7/8/9 nghìn mỗi điểm. */
function departmentPool(averagePoints: number, overTargetStaff: number): number {
  if (overTargetStaff === 0) return 0;
  const perStaff =
    7_000 * Math.min(Math.max(averagePoints - 100, 0), 30) +
    8_000 * Math.min(Math.max(averagePoints - 130, 0), 30) +
    9_000 * Math.max(averagePoints - 160, 0);
  return perStaff * overTargetStaff;
}

export function manager({ role, points, teamPoints, workDays }: ManagerSalaryInput): SalaryResult {
  const direct = roundPoints(points);
  const reached = teamPoints.filter((p) => p >= 100).length;
  const unit = role === "head" ? 9 : 6;
  const managementPoints = unit * reached;
  const average =
    teamPoints.length === 0 ? 0 : teamPoints.reduce((sum, p) => sum + p, 0) / teamPoints.length;
  const overTargetStaff = teamPoints.filter((p) => p > 100).length;
  const poolShare = role === "head" ? 0.7 : 0.3;
  const days = Math.min(workDays, MAX_DAYS);
  const rate = role === "head" ? 120_000 : 80_000;
  const items: SalaryItem[] = [
    {
      label: "Nhân viên đạt 100 điểm",
      formula: `${reached} người × ${unit} điểm × ${vnd(rate)}`,
      amount: reached * unit * rate,
    },
    {
      label: "Làm trực tiếp",
      formula: `${formatPoints(Math.max(direct, 0))} điểm × 70.000đ`,
      amount: Math.max(direct, 0) * 70_000,
    },
    {
      label: "Thưởng vượt của phòng",
      formula: `Trung bình ${formatPoints(roundPoints(average))} điểm - ${overTargetStaff} người vượt - ${role === "head" ? "70%" : "30%"} quỹ`,
      amount: departmentPool(average, overTargetStaff) * poolShare,
    },
    { label: "Hỗ trợ ăn ca", formula: `${days} ngày × 120.000đ`, amount: days * DAILY_SUPPORT },
  ];
  return {
    amount: Math.max(0, Math.round(total(items))),
    facts: [
      { label: "Điểm KPI", value: `${formatPoints(direct)} điểm` },
      { label: "Điểm quản lý", value: `${formatPoints(managementPoints)} điểm` },
      { label: "Nhân viên trong phòng", value: `${teamPoints.length} người` },
      { label: "Ngày công", value: `${days} ngày` },
    ],
    items,
  };
}

export function deputyDirector({ teamPoints, branchPoints }: DeputyDirectorSalaryInput): SalaryResult {
  const reached = teamPoints.filter((p) => p >= 100).length;
  const managementPoints = 3 * reached;
  const managementPay = managementPoints * 150_000;
  const branchBonus =
    2_000 * Math.min(Math.max(branchPoints, 0), 10_000) +
    3_000 * Math.min(Math.max(branchPoints - 10_000, 0), 5_000) +
    4_000 * Math.max(branchPoints - 15_000, 0);
  const tier1 = roundPoints(Math.min(Math.max(branchPoints, 0), 10_000));
  const tier2 = roundPoints(Math.min(Math.max(branchPoints - 10_000, 0), 5_000));
  const tier3 = roundPoints(Math.max(branchPoints - 15_000, 0));
  const dailySupport = DEPUTY_DIRECTOR_DAYS * DAILY_SUPPORT;
  return {
    amount: Math.max(0, Math.round(managementPay + branchBonus + dailySupport)),
    facts: [
      { label: "Điểm quản lý", value: `${formatPoints(managementPoints)} điểm` },
      { label: "Nhân viên các phòng phụ trách", value: `${teamPoints.length} người` },
      { label: "Tổng điểm nhánh", value: `${formatPoints(roundPoints(branchPoints))} điểm` },
      { label: "Ngày công", value: `${DEPUTY_DIRECTOR_DAYS} ngày` },
    ],
    items: [
      {
        label: "Nhân viên đạt 100 điểm",
        formula: `${reached} người × 3 điểm × 150.000đ`,
        amount: managementPay,
      },
      { label: "Thưởng nhánh mốc 1", formula: `${formatPoints(tier1)} điểm × 2.000đ`, amount: tier1 * 2_000 },
      { label: "Thưởng nhánh mốc 2", formula: `${formatPoints(tier2)} điểm × 3.000đ`, amount: tier2 * 3_000 },
      { label: "Thưởng nhánh mốc 3", formula: `${formatPoints(tier3)} điểm × 4.000đ`, amount: tier3 * 4_000 },
      {
        label: "Hỗ trợ ăn ca",
        formula: `${DEPUTY_DIRECTOR_DAYS} ngày × 120.000đ`,
        amount: dailySupport,
      },
    ],
  };
}

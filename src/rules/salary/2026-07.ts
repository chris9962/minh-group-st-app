import { formatPoints, roundPoints } from "@/lib/format";
import type { ManagerSalaryInput, SalaryItem, SalaryResult, StaffSalaryInput } from "./index";

/**
 * Lương CĐS tháng 2026-07, theo quy chế 107/108 ban hành 2026-07-01.
 *
 * ĐÓNG BĂNG: kỳ đã qua. Quy chế đổi thì thêm file kỳ mới.
 *
 * Kỳ này Trưởng/Phó phòng còn bị trừ điểm theo nhân viên dưới 100 điểm và được
 * cộng khi cả phòng vượt 100 (chú thích 7, 8 của Phụ lục 05). Chưa có "Làm trực
 * tiếp" và chưa có bảng lương Phó GĐ.
 */

const DAILY_SUPPORT = 120_000;
const MAX_DAYS = 26;

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
  const below = teamPoints.length - reached;
  const allOver = teamPoints.length > 0 && teamPoints.every((p) => p > 100);
  const unit = role === "head" ? 9 : 6;
  const managementPoints = unit * reached - unit * below + (allOver ? unit : 0);
  const average =
    teamPoints.length === 0 ? 0 : teamPoints.reduce((sum, p) => sum + p, 0) / teamPoints.length;
  const overTargetStaff = teamPoints.filter((p) => p > 100).length;
  const poolShare = role === "head" ? 0.7 : 0.3;
  const days = Math.min(workDays, MAX_DAYS);
  const rate = role === "head" ? 120_000 : 80_000;
  const subtotal =
    managementPoints * rate + departmentPool(average, overTargetStaff) * poolShare + days * DAILY_SUPPORT;
  return {
    amount: Math.max(0, Math.round(subtotal)),
    facts: [
      { label: "Điểm KPI", value: `${formatPoints(direct)} điểm` },
      { label: "Điểm quản lý", value: `${formatPoints(managementPoints)} điểm` },
      { label: "Nhân viên trong phòng", value: `${teamPoints.length} người` },
      { label: "Ngày công", value: `${days} ngày` },
    ],
    // Điểm quản lý tách từng dòng theo số người, vì một con số gộp như
    // "27 điểm" không cho Trưởng phòng tự kiểm được ai đạt, ai chưa.
    items: [
      {
        label: "Nhân viên đạt 100 điểm",
        formula: `${reached} người × ${unit} điểm × ${vnd(rate)}`,
        amount: reached * unit * rate,
      },
      {
        label: "Nhân viên dưới 100 điểm",
        formula: `${below} người × -${unit} điểm × ${vnd(rate)}`,
        amount: -below * unit * rate,
      },
      {
        label: "Cả phòng vượt 100 điểm",
        formula: `${unit} điểm × ${vnd(rate)}`,
        amount: allOver ? unit * rate : 0,
      },
      {
        label: "Thưởng vượt của phòng",
        formula: `Trung bình ${formatPoints(roundPoints(average))} điểm - ${overTargetStaff} người vượt - ${role === "head" ? "70%" : "30%"} quỹ`,
        amount: departmentPool(average, overTargetStaff) * poolShare,
      },
      { label: "Hỗ trợ ăn ca", formula: `${days} ngày × 120.000đ`, amount: days * DAILY_SUPPORT },
      { label: "Điều chỉnh tối thiểu", formula: "Lương không âm", amount: Math.max(0, -subtotal) },
    ],
  };
}

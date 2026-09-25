import { formatPoints, roundPoints } from "@/lib/format";
import type {
  DeputyDirectorSalaryInput,
  ManagerSalaryInput,
  QuotaProgress,
  SalaryItem,
  SalaryResult,
  StaffSalaryInput,
} from "./index";

/**
 * Lương CĐS từ tháng 2026-09: kỳ 2026-08 cộng phần chỉ tiêu của QĐ 145 (chốt
 * với chủ dự án 2026-09-25). Số chỉ tiêu do admin nhập ở màn Chỉ tiêu tháng.
 *
 * - Nhân viên HĐLĐ, tài khoản định hướng: đạt cộng 3 điểm, thiếu trừ 1 điểm
 *   cho mỗi 1% (QĐ 107 Phụ lục 04). Điểm này vào điểm KPI trước khi chia mốc.
 *   Chỉ tiêu HKD và CASA của nhân viên chỉ lưu: Phụ lục 04 không có mức.
 * - Trưởng/Phó phòng, HKD và định hướng theo chỉ tiêu phòng: đạt cộng 10, thiếu
 *   trừ 1 điểm cho mỗi 1% (Phụ lục 05).
 * - Phó GĐ, từng phòng phụ trách: đạt cộng 10, thiếu trừ 20 (Phụ lục 07).
 *
 * TODO(lương CĐS, file mẫu CASA của Yên): CASA chưa tính. Nhân viên HĐLĐ cộng
 * 0,2 điểm/tài khoản; Trưởng/Phó phòng đạt cộng 4, thiếu trừ 10; tự mở cộng
 * 0,2 điểm/tài khoản × 70.000đ. Gỡ khi có màn nhập danh sách CASA.
 */

const DAILY_SUPPORT = 120_000;
const MAX_DAYS = 26;
const DEPUTY_DIRECTOR_DAYS = 22;

const vnd = (amount: number) => `${amount.toLocaleString("vi-VN")}đ`;
const total = (items: SalaryItem[]) => items.reduce((sum, item) => sum + item.amount, 0);

/** Phần trăm còn thiếu, 2 số lẻ. Đạt từ chỉ tiêu trở lên là 0. */
const shortfallPercent = ({ target, achieved }: QuotaProgress): number =>
  achieved >= target ? 0 : roundPoints(((target - achieved) / target) * 100);

/** Đạt thì cộng `reward`; thiếu thì trừ `penalty(Thiếu%)`. */
function quotaResult(
  quota: QuotaProgress,
  reward: number,
  penalty: (shortfall: number) => number,
): { points: number; text: string } {
  const shortfall = shortfallPercent(quota);
  const reached = `${quota.achieved}/${quota.target}`;
  if (shortfall === 0) return { points: reward, text: `${reached}, đạt, cộng ${reward} điểm` };
  const points = -roundPoints(penalty(shortfall));
  return {
    points,
    text: `${reached}, thiếu ${formatPoints(shortfall)}%, trừ ${formatPoints(-points)} điểm`,
  };
}

export function staff({ points, workDays, directedQuota }: StaffSalaryInput): SalaryResult {
  const directed = directedQuota ? quotaResult(directedQuota, 3, (shortfall) => shortfall) : null;
  const direct = roundPoints(points + (directed?.points ?? 0));
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
      { label: "Điểm KPI", value: `${formatPoints(roundPoints(points))} điểm` },
      ...(directed
        ? [
            { label: "Tài khoản định hướng", value: directed.text },
            { label: "Điểm tính lương", value: `${formatPoints(direct)} điểm` },
          ]
        : []),
      { label: "Ngày công", value: `${days} ngày` },
    ],
    items,
  };
}

/** Chỉ tiêu phòng của Trưởng/Phó phòng: đạt cộng 10, thiếu trừ 1 điểm cho mỗi 1%. */
function quotaItems(quota: QuotaProgress | null | undefined, label: string, rate: number): SalaryItem[] {
  if (!quota) return [];
  const result = quotaResult(quota, 10, (shortfall) => shortfall);
  return [{ label, formula: `${result.text} × ${vnd(rate)}`, amount: result.points * rate }];
}

/** Chỉ tiêu các phòng của Phó GĐ: mỗi phòng đạt cộng 10, thiếu trừ 20. */
function branchQuotaItem(quotas: (QuotaProgress | null)[], label: string): SalaryItem[] {
  const scored = quotas.filter((q): q is QuotaProgress => q !== null);
  if (scored.length === 0) return [];
  const passed = scored.filter((q) => q.achieved >= q.target).length;
  const failed = scored.length - passed;
  const points = passed * 10 - failed * 20;
  return [
    {
      label,
      formula: `${passed} phòng đạt × 10 - ${failed} phòng thiếu × 20 = ${points} điểm × 150.000đ`,
      amount: points * 150_000,
    },
  ];
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

export function manager({
  role,
  points,
  teamPoints,
  workDays,
  departmentQuota,
}: ManagerSalaryInput): SalaryResult {
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
    ...quotaItems(departmentQuota?.hkd, "Chỉ tiêu HKD của phòng", rate),
    ...quotaItems(departmentQuota?.directed, "Chỉ tiêu định hướng của phòng", rate),
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

export function deputyDirector({
  teamPoints,
  branchPoints,
  departmentQuotas = [],
}: DeputyDirectorSalaryInput): SalaryResult {
  const quotaItemsOfBranch = [
    ...branchQuotaItem(
      departmentQuotas.map((q) => q.hkd),
      "Chỉ tiêu HKD các phòng",
    ),
    ...branchQuotaItem(
      departmentQuotas.map((q) => q.directed),
      "Chỉ tiêu định hướng các phòng",
    ),
  ];
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
    amount: Math.max(
      0,
      Math.round(managementPay + branchBonus + dailySupport + total(quotaItemsOfBranch)),
    ),
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
      ...quotaItemsOfBranch,
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

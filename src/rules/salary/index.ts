import * as period202607 from "./2026-07";
import * as period202608 from "./2026-08";
import * as period202609 from "./2026-09";

/**
 * Cửa vào DUY NHẤT của công thức lương theo kỳ, cùng lối với `src/rules/index.ts`.
 *
 * Mỗi kỳ một file `YYYY-MM.ts`, file của kỳ đã qua đóng băng. Quy chế đổi thì
 * thêm file kỳ mới và một dòng ở `PERIODS`, không sửa file cũ: sửa file cũ là
 * đổi lương các tháng đã trả.
 *
 * Hàm kỳ là hàm thuần, không đọc DB. `server/salary.ts` đọc điểm, ngày công,
 * người trong phòng rồi đưa vào đây.
 */

export type SalaryItem = { label: string; formula: string; amount: number };
export type SalaryFact = { label: string; value: string };
export type SalaryResult = { amount: number; facts: SalaryFact[]; items: SalaryItem[] };

/** Một chỉ tiêu trong tháng theo QĐ 145: số được giao và số đã đạt. */
export type QuotaProgress = { target: number; achieved: number };

/** Chỉ tiêu phòng; `null` = admin không nhập mục đó, không chấm. */
export type DepartmentQuotaProgress = {
  hkd: QuotaProgress | null;
  directed: QuotaProgress | null;
};

export type StaffSalaryInput = {
  points: number;
  /** Số ngày công trong tháng, chưa cắt trần. */
  workDays: number;
  /** Chỉ tiêu tài khoản định hướng; chỉ nhân viên HĐLĐ có. Kỳ trước 2026-09 bỏ qua. */
  directedQuota?: QuotaProgress | null;
};

export type ManagerSalaryInput = {
  role: "head" | "deputy-head";
  points: number;
  /** Điểm của từng nhân viên ĐANG LÀM trong phòng, không gồm Trưởng/Phó phòng. */
  teamPoints: number[];
  /** Số ngày phòng có ngày công, chưa cắt trần. */
  workDays: number;
  /** Chỉ tiêu của phòng mình. Kỳ trước 2026-09 bỏ qua. */
  departmentQuota?: DepartmentQuotaProgress | null;
};

export type DeputyDirectorSalaryInput = {
  /** Điểm của từng nhân viên ĐANG LÀM trong các phòng phụ trách. */
  teamPoints: number[];
  /** Tổng điểm các phòng phụ trách, gồm cả Phó phòng và người đã nghỉ có điểm. */
  branchPoints: number;
  /** Chỉ tiêu từng phòng phụ trách. Kỳ trước 2026-09 bỏ qua. */
  departmentQuotas?: DepartmentQuotaProgress[];
};

type SalaryRules = {
  staff(input: StaffSalaryInput): SalaryResult;
  manager(input: ManagerSalaryInput): SalaryResult;
  /** Kỳ chưa có bảng lương Phó GĐ thì không khai. */
  deputyDirector?(input: DeputyDirectorSalaryInput): SalaryResult;
};

/** Khoá là THÁNG bắt đầu áp dụng. Tháng trước kỳ đầu tiên không có công thức lương. */
const PERIODS: Record<string, SalaryRules> = {
  "2026-07": period202607,
  "2026-08": period202608,
  "2026-09": period202609,
};

/** File kỳ áp cho `yearMonth`: kỳ mới nhất có tháng bắt đầu không sau tháng đó. */
export function salaryRulesFor(yearMonth: string): SalaryRules | null {
  const latest = Object.keys(PERIODS)
    .filter((start) => start <= yearMonth)
    .sort()
    .at(-1);
  return latest ? PERIODS[latest] : null;
}

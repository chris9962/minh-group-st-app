import { z } from 'zod';
import type { Scope } from '@/lib/types';

/** Số liệu cho P-51 Danh sách nhân viên + điểm. */

/**
 * Kỳ xem bảng.
 *
 * `today` xem hoạt động trong ngày — KHÔNG có cột điểm và trạng thái, vì chỉ
 * tiêu tính theo tháng, điểm của một ngày không so được với chỉ tiêu nào.
 */
export type PeriodMode =
  | { kind: 'today' }
  | { kind: 'this-month' }
  | { kind: 'month'; month: string };

export const periodMonth = (p: PeriodMode, current: string): string =>
  p.kind === 'month' ? p.month : current;

export const showsKpi = (p: PeriodMode): boolean => p.kind !== 'today';

export const periodParam = (p: PeriodMode, current: string): string =>
  p.kind === 'today' ? 'today' : periodMonth(p, current);

export const PersonScore = z.object({
  id: z.string(),
  fullName: z.string(),
  departmentName: z.string(),
  /** Điểm từ ngân hàng: tổng hệ số của app đã cài + CNKD/HKD. */
  bankingPoints: z.number(),
  /** Điểm từ dịch vụ: hệ số theo loại dịch vụ. */
  servicePoints: z.number(),
  accounts: z.number(),
  apps: z.number(),
  insuranceOrders: z.number(),
  /** Chỉ tiêu của riêng người này — để sau còn đặt khác nhau được. */
  target: z.number(),
});
export type PersonScore = z.infer<typeof PersonScore>;

export const PeopleData = z.object({
  /** Tháng của phần tóm tắt. Luôn là tháng, kể cả khi bảng đang xem theo ngày. */
  summaryMonth: z.string(),
  /** Số ngày còn lại của tháng. 0 nếu không phải tháng hiện tại. */
  daysLeft: z.number(),
  summary: z.object({
    headcount: z.number(),
    onTarget: z.number(),
    offTarget: z.number(),
    averagePoints: z.number(),
  }),
  /** Số liệu theo kỳ đang chọn — ngày hoặc tháng. */
  people: z.array(PersonScore),
});
export type PeopleData = z.infer<typeof PeopleData>;

export const totalPoints = (p: PersonScore) => p.bankingPoints + p.servicePoints;
export const isOnTarget = (p: PersonScore) => totalPoints(p) >= p.target;
export const pointsGap = (p: PersonScore) => totalPoints(p) - p.target;

export async function fetchPeople(
  scope: Scope,
  period: string,
  summaryMonth: string,
): Promise<PeopleData> {
  const res = await fetch(
    `/api/people?scope=${scope}&period=${period}&summaryMonth=${summaryMonth}`,
  );
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên');
  return PeopleData.parse(await res.json());
}

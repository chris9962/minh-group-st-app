import { z } from 'zod';
import type { Scope } from '@/lib/types';

/** Số liệu cho P-51 Danh sách nhân viên + điểm. */

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
  month: z.string(),
  /** Số ngày còn lại của tháng — dùng cho cảnh báo cuối tháng. */
  daysLeft: z.number(),
  people: z.array(PersonScore),
});
export type PeopleData = z.infer<typeof PeopleData>;

export const totalPoints = (p: PersonScore) => p.bankingPoints + p.servicePoints;
export const isOnTarget = (p: PersonScore) => totalPoints(p) >= p.target;
export const pointsGap = (p: PersonScore) => totalPoints(p) - p.target;

export async function fetchPeople(scope: Scope, month: string): Promise<PeopleData> {
  const res = await fetch(`/api/people?scope=${scope}&month=${month}`);
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên');
  return PeopleData.parse(await res.json());
}

import { z } from 'zod';
import type { Period } from '@/components/ui/PeriodPicker';
import { periodKey } from '@/components/ui/PeriodPicker';
import type { Scope } from '@/lib/types';

/** Số liệu cho P-80 Dashboard tổng. */

export const DashboardData = z.object({
  /** Chỉ số quan trọng nhất: tỉ lệ cài app trên số tài khoản mở. */
  installRate: z.object({
    percent: z.number(),
    appsInstalled: z.number(),
    accountsOpened: z.number(),
    previousPercent: z.number(),
  }),
  banking: z.object({
    accountsOpened: z.number(),
    appsInstalled: z.number(),
    /** Số khách hàng có phát sinh trong kỳ. */
    customers: z.number(),
    giftsPending: z.number(),
  }),
  insurance: z.object({
    createdToday: z.number(),
    fireCount: z.number(),
    motorbikeCount: z.number(),
    completed: z.number(),
    completedPercent: z.number(),
    /** Số tức thời — "ngay lúc này còn bao nhiêu đơn chưa xong", không theo kỳ. */
    pending: z.number(),
    pendingBot: z.number(),
    pendingManual: z.number(),
    /**
     * Cột của biểu đồ. Độ chia do KỲ quyết định, không cố định theo giờ:
     * một ngày → khung giờ, một tháng → ngày, dài hơn → tuần hoặc tháng.
     */
    bucketType: z.enum(['hour', 'day', 'week', 'month']),
    buckets: z.array(
      z.object({ label: z.string(), automatic: z.number(), manual: z.number() }),
    ),
  }),
  /** Xếp hạng phòng — chỉ gồm các phòng người xem được phép thấy. */
  departments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      accountsOpened: z.number(),
      appsInstalled: z.number(),
      customers: z.number(),
    }),
  ),
  services: z.object({
    byType: z.array(z.object({ label: z.string(), count: z.number() })),
    topWard: z.object({ name: z.string(), count: z.number() }),
  }),
  gifts: z.object({
    byType: z.array(z.object({ label: z.string(), count: z.number() })),
    /** Khách đủ điều kiện nhưng chưa phát quà — khớp thẻ ở đầu trang. */
    pending: z.number(),
  }),
});
export type DashboardData = z.infer<typeof DashboardData>;

export async function fetchDashboard(
  scope: Scope,
  period: Period,
): Promise<DashboardData> {
  const res = await fetch(
    `/api/dashboard?scope=${scope}&period=${encodeURIComponent(periodKey(period))}`,
  );
  if (!res.ok) throw new Error('Không tải được số liệu tổng quan');
  return DashboardData.parse(await res.json());
}

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
    codesRunningLow: z.number(),
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
    avgMinutes: z.number(),
    avgSeconds: z.number(),
    byHour: z.array(
      z.object({ label: z.string(), automatic: z.number(), manual: z.number() }),
    ),
  }),
  quality: z.object({
    botSuccessPercent: z.number(),
    botAvgMinutes: z.number(),
    botAvgSeconds: z.number(),
    manualOrders: z.number(),
    badInputOrders: z.number(),
    overnightOrders: z.number(),
  }),
  services: z.object({
    byType: z.array(z.object({ label: z.string(), count: z.number() })),
    topWard: z.object({ name: z.string(), count: z.number() }),
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

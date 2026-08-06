import { z } from 'zod';
import type { Period } from '@/components/ui/PeriodPicker';
import { periodKey } from '@/components/ui/PeriodPicker';
import type { Scope } from '@/lib/types';

/** Số liệu cho P-80 Dashboard tổng. */

/**
 * Một dòng xếp hạng phòng — dùng chung với P-91 (Phòng ban) qua
 * `src/lib/api/org.ts` nên tách riêng, không khai lại cùng hình dạng ở hai
 * chỗ.
 */
export const DepartmentRanking = z.object({
  id: z.string(),
  name: z.string(),
  accountsOpened: z.number(),
  appsInstalled: z.number(),
  customers: z.number(),
  /**
   * Tỉ lệ cài của kỳ liền trước, để so tăng/giảm. `null` khi không có kỳ nào
   * để so — người dùng tự chọn khoảng ngày.
   */
  previousInstallRate: z.number().nullable(),
});
export type DepartmentRanking = z.infer<typeof DepartmentRanking>;

export const DashboardData = z.object({
  /** Chỉ số quan trọng nhất: tỉ lệ cài app trên số tài khoản mở. */
  installRate: z.object({
    percent: z.number(),
    appsInstalled: z.number(),
    accountsOpened: z.number(),
    /**
     * Tỉ lệ của kỳ liền trước: hôm nay so hôm qua, tháng này so tháng trước.
     * `null` khi người dùng tự chọn khoảng ngày — một khoảng tuỳ ý không có
     * "kỳ liền trước" nào định nghĩa được.
     */
    previousPercent: z.number().nullable(),
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
    /** Bảo hiểm tai nạn hộ sử dụng điện. */
    electricCount: z.number(),
    /** Bảo hiểm xe máy. */
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
      z.object({
        label: z.string(),
        /** Bảo hiểm tai nạn hộ sử dụng điện. */
        electric: z.number(),
        /** Bảo hiểm xe máy. */
        motorbike: z.number(),
      }),
    ),
  }),
  /** Xếp hạng phòng — chỉ gồm các phòng người xem được phép thấy. */
  departments: z.array(DepartmentRanking),
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

/**
 * TODO(P-01 Tổng quan, chờ thiết kế cho từng chức vụ): route `/api/dashboard`
 * CHƯA TỒN TẠI, gọi vào là 404 và màn chủ hiện khối báo lỗi.
 *
 * Hiện mới chốt bố cục cho CEO; trưởng phòng, phó phòng và nhân viên sẽ có màn
 * riêng với chỉ số khác nhau, nên chưa dựng máy chủ vội — dựng theo bản CEO rồi
 * sửa lại là làm hai lần. Gỡ mốc ở cả hai đầu khi có bản thiết kế đủ 5 chức vụ.
 */
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

import { z } from 'zod';
import type { BankAccountQuery } from './banking';
import type { PageQuery } from './pagination';

/**
 * P-73 báo cáo #1 · Tính điểm tổng — MỘT KHÁCH MỘT DÒNG.
 *
 * Dựng lại đúng hình dạng sheet `TỔNG` của `TÍNH ĐIỂM TỔNG T8.xlsx`, file Kế
 * toán đang dùng thật. Ánh xạ từng cột ghi ở `mgst-the-le/2026-08.md` mục 4c.
 *
 * Khác `BankAccountRow` ở chỗ đó: kia là MỘT TÀI KHOẢN một dòng, cho màn danh
 * sách P-21. Không gộp hai hợp đồng làm một — màn danh sách không cần điểm, còn
 * báo cáo này không cần id tài khoản.
 */
export const ScoringExportRow = z.object({
  customerId: z.string(),
  customerName: z.string(),
  /** CCCD đầy đủ. Route gác bằng `customer:access-id-number`. */
  idNumber: z.string(),
  phone: z.string(),
  /** Ngày mở tài khoản SỚM NHẤT của khách — cột `NGÀY` của file. */
  date: z.string(),
  /** Dạng `ẤP/XÃ`, tách từ `customers.channel_detail`. */
  hamlet: z.string(),
  channelName: z.string(),
  /** Mã ngân hàng khách đã mở, KHÔNG gồm `CNKD`/`HKD`. */
  openedBanks: z.array(z.string()),
  msbAccountNumber: z.string(),
  /** `CNKD` · `HKD` · rỗng. */
  household: z.string(),
  installedBanks: z.array(z.string()),
  giftReport: z.string(),
  giftCombo: z.string(),
  speaker: z.string(),
  insuranceLabel: z.string(),
  licensePlate: z.string(),
  beneficiaryName: z.string(),
  staffCode: z.string(),
  departmentName: z.string(),
  priorityCount: z.number(),
  otherCount: z.number(),
  restrictedCount: z.number(),
  combo2Points: z.number(),
  combo3Points: z.number(),
  householdPoints: z.number(),
  totalPoints: z.number(),
});
export type ScoringExportRow = z.infer<typeof ScoringExportRow>;

const ScoringExportPage = z.object({
  rows: z.array(ScoringExportRow),
  total: z.number(),
});

/**
 * Khách nào vào file — xem `ScoringInclude` ở `server/exports.ts`.
 *
 * `with-accounts` là mặc định và là hình dạng cũ của báo cáo.
 */
export const SCORING_INCLUDE = ['with-accounts', 'all'] as const;
export type ScoringInclude = (typeof SCORING_INCLUDE)[number];

export const SCORING_INCLUDE_LABEL: Record<ScoringInclude, string> = {
  'with-accounts': 'Chỉ khách có tài khoản',
  all: 'Tất cả khách',
};

/**
 * TRỌN danh sách khớp bộ lọc, đã gộp theo khách ở máy chủ.
 *
 * `total` đếm KHÁCH, không đếm tài khoản — nơi gọi so với `rows.length` để biết
 * đã chạm trần chưa, mà một file thiếu dòng trông y hệt file đủ.
 */
export async function fetchScoringExport(
  query: Omit<BankAccountQuery, keyof PageQuery>,
  include: ScoringInclude = 'with-accounts',
  /**
   * Bỏ CCCD và số điện thoại khỏi mỗi dòng — bảng hiện trên màn bật cờ này,
   * đường xuất Excel thì không (chốt 2026-09-04).
   *
   * Cờ cũng là điều kiện để NGƯỜI TỰ XEM MÌNH đi qua cửa quyền: xem
   * `/api/exports/scoring`.
   */
  omitPii = false,
): Promise<{ rows: ScoringExportRow[]; total: number }> {
  const params = new URLSearchParams({
    search: query.search,
    bankCode: query.bankCode,
    from: query.from,
    to: query.to,
    referralCode: query.referralCode,
    channelId: query.channelId,
    staffId: query.staffId,
    status: query.status,
    include,
    ...(omitPii ? { omitPii: '1' } : {}),
  });
  const res = await fetch(`/api/exports/scoring?${params}`);
  if (!res.ok) throw new Error('Không tải được dữ liệu tính điểm tổng');
  return ScoringExportPage.parse(await res.json());
}

/* ── Báo cáo #4 · Số liệu cấp đơn bảo hiểm ──────────────────────────── */

/** Trục gộp của báo cáo — phòng ghi nhận lúc tạo đơn, hoặc người tạo đơn. */
export const OrderStatsGroupBy = z.enum(['department', 'staff']);
export type OrderStatsGroupBy = z.infer<typeof OrderStatsGroupBy>;

/** Một ngày, một nhóm, mười con số. Máy chủ luôn trả theo NGÀY; gộp tháng là việc của giao diện. */
export const OrderStatsCell = z.object({
  day: z.string(),
  groupId: z.string(),
  motorbike: z.number(),
  motorbikeYears: z.number(),
  electric100: z.number(),
  electric200: z.number(),
  health: z.number(),
  motorbikeCancelled: z.number(),
  motorbikeYearsCancelled: z.number(),
  electric100Cancelled: z.number(),
  electric200Cancelled: z.number(),
  healthCancelled: z.number(),
});
export type OrderStatsCell = z.infer<typeof OrderStatsCell>;

export const OrderStatsResult = z.object({
  /** Đúng thứ tự dòng trong sheet. Gộp theo phòng thì có cả phòng 0 đơn; trục nhân viên kèm tên phòng. */
  groups: z.array(z.object({ id: z.string(), label: z.string(), department: z.string().optional() })),
  cells: z.array(OrderStatsCell),
});
export type OrderStatsResult = z.infer<typeof OrderStatsResult>;

/** Số liệu cấp đơn của TRỌN một tháng, `month` dạng `YYYY-MM`. */
export async function fetchOrderStats(
  month: string,
  groupBy: OrderStatsGroupBy,
): Promise<OrderStatsResult> {
  const res = await fetch(`/api/exports/order-stats?month=${month}&groupBy=${groupBy}`);
  if (!res.ok) throw new Error('Không tải được số liệu cấp đơn');
  return OrderStatsResult.parse(await res.json());
}

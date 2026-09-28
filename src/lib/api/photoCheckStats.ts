import { z } from 'zod';

/**
 * Tab Hiệu suất kiểm ảnh ở trang chi tiết ngân hàng (chốt 2026-09-28).
 *
 * Mỗi tài khoản đã hoàn thành tính một lần, theo lượt kiểm MỚI NHẤT: màn danh
 * sách và cảnh báo cho nhân viên cũng đọc lượt đó. Lọc theo ngày mở tài khoản,
 * cùng điều kiện với tab Tài khoản để hai tab ra cùng tổng.
 */
export const PhotoCheckStatsDay = z.object({
  /** `YYYY-MM-DD`. */
  day: z.string(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
});
export type PhotoCheckStatsDay = z.infer<typeof PhotoCheckStatsDay>;

export const PhotoCheckStatsReason = z.object({ label: z.string(), count: z.number() });
export type PhotoCheckStatsReason = z.infer<typeof PhotoCheckStatsReason>;

/**
 * Ai gây ra lần sửa đầu tiên sau khi bot chấm lượt 1 không đạt. `none` = chưa
 * có lượt kiểm thứ hai.
 */
export const PhotoCheckFixBy = z.enum(['self', 'after-error', 'code-change', 'none']);
export type PhotoCheckFixBy = z.infer<typeof PhotoCheckFixBy>;

export const PhotoCheckStatsFix = z.object({
  by: PhotoCheckFixBy,
  count: z.number(),
  /** Lượt kiểm mới nhất bot chấm đạt. */
  passed: z.number(),
  /** Trung vị số phút từ lượt 1 tới lần sửa; `null` khi nhóm không có ai sửa. */
  medianMinutes: z.number().nullable(),
});
export type PhotoCheckStatsFix = z.infer<typeof PhotoCheckStatsFix>;

export const PhotoCheckStats = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  /** Chưa có lượt kiểm xong: đang chờ, worker hỏng, hoặc ngân hàng chưa bật kiểm ảnh. */
  unchecked: z.number(),
  failedConfirmed: z.number(),
  failedMarkedError: z.number(),
  failedUnreviewed: z.number(),
  /** Người duyệt đánh lỗi lúc lượt kiểm gần nhất của bot đang chấm đạt. */
  passedMarkedError: z.number(),
  /** Một tài khoản có thể có nhiều lý do, nên tổng các dòng lớn hơn `failed`. */
  reasons: z.array(PhotoCheckStatsReason),
  /** Đủ bốn nhóm theo thứ tự `PhotoCheckFixBy`; cộng lại ra số tài khoản lượt 1 không đạt. */
  fixes: z.array(PhotoCheckStatsFix),
  days: z.array(PhotoCheckStatsDay),
});
export type PhotoCheckStats = z.infer<typeof PhotoCheckStats>;

export async function fetchPhotoCheckStats(
  bankId: string,
  query: { from: string; to: string },
): Promise<PhotoCheckStats> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const res = await fetch(`/api/settings/banks/${bankId}/photo-check-stats?${params}`);
  if (res.status === 403) throw new Error('Bạn không quản ngân hàng này');
  if (!res.ok) throw new Error('Không tải được số liệu kiểm ảnh của ngân hàng');
  return PhotoCheckStats.parse(await res.json());
}

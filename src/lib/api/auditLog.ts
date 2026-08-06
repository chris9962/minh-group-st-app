import { z } from 'zod';
import { Action, ModuleKey } from '@/lib/types';

/**
 * P-93 · Nhật ký truy vết — ai · làm gì · lúc nào · trên bản ghi nào
 * (mgst-feature-list.md P-93 · mgst-platform-spec.md §10.4).
 *
 * Chỉ `system:view-detail` mới xem được — quan trọng hơn bình thường vì mọi
 * nhân viên xem được CCCD/địa chỉ của mọi khách, nên phải ghi lại ai xem gì.
 */

export const AuditLogEntry = z.object({
  id: z.string(),
  /** ISO datetime — lúc hành động xảy ra. */
  at: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  actorUsername: z.string(),
  module: ModuleKey,
  action: Action,
  /** Bản ghi bị tác động, ví dụ "Nhân viên Trần Văn Hậu", "Tài khoản MB của Nguyễn Văn A". */
  targetLabel: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

export const AuditLogQuery = z.object({
  /** Lọc theo người thực hiện — rỗng là lấy hết. */
  staffId: z.string(),
  action: z.union([Action, z.literal('')]),
  from: z.string(),
  to: z.string(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

export const AuditLogList = z.object({
  rows: z.array(AuditLogEntry),
  summary: z.object({ total: z.number() }),
});
export type AuditLogList = z.infer<typeof AuditLogList>;

export async function fetchAuditLog(
  query: AuditLogQuery & { actorId: string },
): Promise<AuditLogList> {
  const params = new URLSearchParams({
    actorId: query.actorId,
    staffId: query.staffId,
    action: query.action,
    from: query.from,
    to: query.to,
  });
  // TODO(P-93 Nhật ký truy vết, chờ nối FE–BE): route `/api/audit-log` CHƯA CÓ,
  // gọi vào là 404. Phần GHI nhật ký đã chạy thật (`server/audit.ts`, bảng
  // `audit_log` đang đầy dòng) — chỉ thiếu đúng đường đọc lên. Gỡ mốc ở cả hai
  // đầu khi dựng `src/app/api/audit-log/route.ts`.
  const res = await fetch(`/api/audit-log?${params}`);
  if (res.status === 403) throw new Error('Bạn không có quyền xem nhật ký truy vết');
  if (!res.ok) throw new Error('Không tải được nhật ký truy vết');
  return AuditLogList.parse(await res.json());
}

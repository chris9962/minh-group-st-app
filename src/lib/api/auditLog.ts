import { z } from 'zod';
import { Action, ModuleKey } from '@/lib/types';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-93 · Nhật ký hoạt động — ai · làm gì · lúc nào · trên bản ghi nào
 * (mgst-feature-list.md P-93 · mgst-platform-spec.md §10.4).
 *
 * Chỉ `system:manage-org` mới xem được — KHÔNG dùng `view-detail`, vì Kế toán
 * tổng hợp cũng có `view-detail` qua wildcard `*` dù không nên thấy nhật ký.
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

/**
 * Đúng MỘT khoá sắp, và đây không phải chuyện làm cho gọn.
 *
 * `audit_log` chỉ có hai chỉ mục: `(at desc)` và `(actor_id, at desc)`. Cho sắp
 * theo tên người hay theo đối tượng nghĩa là bắt Postgres sắp CẢ BẢNG mỗi lần
 * mở màn để lấy 15 dòng — đúng thứ §5.2 cấm, và bảng này là bảng phình nhanh
 * nhất hệ thống. Cột khác vẫn hiện, chỉ là không bấm sắp được.
 */
export const AUDIT_LOG_SORT = ['at'] as const;
export type AuditLogSort = (typeof AUDIT_LOG_SORT)[number];

export type AuditLogQuery = PageQuery<AuditLogSort> & {
  /** Lọc theo người thực hiện — rỗng là lấy hết. */
  staffId: string;
  action: Action | '';
  /** Khoảng NGÀY theo giờ Việt Nam, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
};

const AuditLogPage = pageOf(AuditLogEntry);

/**
 * MỘT trang nhật ký. Lọc, sắp và cắt trang đều do máy chủ làm (AGENTS.md §5.1);
 * bảng này không có đường "lấy hết" — nó chỉ phình chứ không teo
 * (mgst-db-design.md §11 điều 6).
 */
export async function fetchAuditLog(query: AuditLogQuery): Promise<Page<AuditLogEntry>> {
  const res = await fetch(
    `/api/audit-log?${pageParams(query, {
      staffId: query.staffId,
      action: query.action,
      from: query.from,
      to: query.to,
    })}`,
  );
  if (res.status === 403) throw new Error('Bạn không có quyền xem nhật ký hoạt động');
  if (!res.ok) throw new Error('Không tải được nhật ký hoạt động');
  return AuditLogPage.parse(await res.json());
}

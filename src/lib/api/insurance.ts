import { z } from 'zod';
import { Scope } from '@/lib/types';
import { InsuranceOrderSource, InsuranceOrderStatus } from './insuranceOrders';

/**
 * P-13 · Danh sách đơn bảo hiểm · P-14 · Chi tiết
 * (mgst-feature-list.md P-13/P-14 · mgst-platform-spec.md §3.4, §3.6).
 */

export const InsuranceListRow = z.object({
  id: z.string(),
  orderCode: z.string(),
  customerName: z.string(),
  product: z.string(),
  packageName: z.string(),
  status: InsuranceOrderStatus,
  date: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
});
export type InsuranceListRow = z.infer<typeof InsuranceListRow>;

/** P-14 · Toàn bộ dữ liệu đã nhập — không có nút sửa/huỷ sau khi bot đã chạy (spec §10.1). */
export const InsuranceDetail = InsuranceListRow.extend({
  /** null với đơn giả lập P-51/P-52 — không gắn hồ sơ khách thật để dẫn ngược lại. */
  customerId: z.string().nullable(),
  source: InsuranceOrderSource,
  beneficiaryName: z.string(),
  beneficiaryDob: z.string(),
  beneficiaryIdNumber: z.string(),
  beneficiaryPhone: z.string(),
  createdByDepartmentId: z.string().nullable(),
});
export type InsuranceDetail = z.infer<typeof InsuranceDetail>;

export const InsuranceQuery = z.object({
  scope: Scope,
  status: z.string(),
  product: z.string(),
  from: z.string(),
  to: z.string(),
  staffId: z.string(),
});
export type InsuranceQuery = z.infer<typeof InsuranceQuery>;

export const InsuranceList = z.object({
  rows: z.array(InsuranceListRow),
  summary: z.object({ total: z.number() }),
});
export type InsuranceList = z.infer<typeof InsuranceList>;

export async function fetchInsuranceOrders(
  query: InsuranceQuery & { actorId: string },
): Promise<InsuranceList> {
  const params = new URLSearchParams({
    actorId: query.actorId,
    scope: query.scope,
    status: query.status,
    product: query.product,
    from: query.from,
    to: query.to,
    staffId: query.staffId,
  });
  const res = await fetch(`/api/insurance-list?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách đơn bảo hiểm');
  return InsuranceList.parse(await res.json());
}

export async function fetchInsuranceDetail(id: string, actorId: string): Promise<InsuranceDetail> {
  const params = new URLSearchParams({ actorId });
  const res = await fetch(`/api/insurance-list/${id}?${params}`);
  if (res.status === 404) throw new Error('Không tìm thấy đơn bảo hiểm này');
  if (!res.ok) throw new Error('Không tải được chi tiết đơn bảo hiểm');
  return InsuranceDetail.parse(await res.json());
}

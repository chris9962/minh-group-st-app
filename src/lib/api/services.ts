import { z } from 'zod';
import { Scope } from '@/lib/types';

/**
 * P-30 · Ghi dịch vụ · P-31 · Danh sách dịch vụ
 * (mgst-feature-list.md §4.6/§2.3 · mgst-platform-spec.md §6).
 *
 * Nghiệp vụ mới, mức chi tiết còn thấp: KHÔNG thu phí (đã chốt ở feature-list,
 * đóng câu hỏi mở trong spec), KHÔNG có màn chi tiết riêng (không có P-32).
 */

export const ServiceRow = z.object({
  id: z.string(),
  customerName: z.string(),
  serviceTypeId: z.string(),
  serviceTypeName: z.string(),
  note: z.string(),
  date: z.string(),
  createdById: z.string(),
  createdByName: z.string(),
  /** Đơn vị của người tạo LÚC TẠO — chụp một lần, không tra động (spec §1.1.5). */
  createdByDepartmentId: z.string().nullable(),
  /**
   * Chỉ có giá trị khi người tạo thuộc Phòng Dự Án — ghi lúc tạo, không tra
   * động từ hồ sơ nhân viên (spec §6: đổi xã phụ trách không được làm đổi
   * dữ liệu tháng trước).
   */
  wardName: z.string().nullable(),
});
export type ServiceRow = z.infer<typeof ServiceRow>;

export const ServiceQuery = z.object({
  scope: Scope,
  search: z.string(),
  serviceTypeId: z.string(),
  from: z.string(),
  to: z.string(),
  ward: z.string(),
  staffId: z.string(),
});
export type ServiceQuery = z.infer<typeof ServiceQuery>;

export const ServiceList = z.object({
  rows: z.array(ServiceRow),
  summary: z.object({ total: z.number() }),
});
export type ServiceList = z.infer<typeof ServiceList>;

export async function fetchServices(
  query: ServiceQuery & { actorId: string },
): Promise<ServiceList> {
  const params = new URLSearchParams({
    actorId: query.actorId,
    scope: query.scope,
    search: query.search,
    serviceTypeId: query.serviceTypeId,
    from: query.from,
    to: query.to,
    ward: query.ward,
    staffId: query.staffId,
  });
  const res = await fetch(`/api/services?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách dịch vụ');
  return ServiceList.parse(await res.json());
}

/** Tên không ràng buộc gì thêm — chỉ ghi lại việc đã hỗ trợ khách xong. */
export const ServiceForm = z.object({
  customerId: z.string().min(1, 'Chưa chọn khách'),
  serviceTypeId: z.string().min(1, 'Chưa chọn loại dịch vụ'),
  note: z.string().trim(),
});
export type ServiceForm = z.infer<typeof ServiceForm>;

export async function createService(form: ServiceForm, actorId: string): Promise<ServiceRow> {
  const res = await fetch('/api/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...form, actorId }),
  });
  if (!res.ok) throw new Error('Không lưu được dịch vụ này');
  return ServiceRow.parse(await res.json());
}

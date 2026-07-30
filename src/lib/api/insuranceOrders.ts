import { z } from 'zod';

/**
 * Tạo đơn bảo hiểm — người thụ hưởng có thể KHÁC khách hàng (spec §5.4).
 *
 * Dựng để DÙNG LẠI: mở từ luồng Tặng quà (P-43, `source: 'gift'`, sản phẩm cố
 * định theo món đã chọn) hôm nay, và sẽ mở lại y hệt từ P-10/P-11 (tự khách
 * mua, `source: 'self'`, tự chọn sản phẩm) khi màn đó được xây.
 */

export const InsuranceOrderSource = z.enum(['self', 'gift']);
export type InsuranceOrderSource = z.infer<typeof InsuranceOrderSource>;

/**
 * Vòng đời đơn — 5 mốc chốt lại còn 4 trạng thái hiện trên P-13 (spec §3.4,
 * mgst-feature-list.md P-13): "Đã tiếp nhận" và "Đang tạo đơn trên PVI" gộp
 * chung một nhãn `creating` vì P-13 chỉ hiện một badge cho cả hai mốc.
 * `pending-approval` từng bị thiếu hẳn trong code cũ (chỉ có 3 trạng thái).
 */
export const InsuranceOrderStatus = z.enum(['creating', 'pending-approval', 'manual', 'done']);
export type InsuranceOrderStatus = z.infer<typeof InsuranceOrderStatus>;

export const INSURANCE_STATUS_LABEL: Record<InsuranceOrderStatus, string> = {
  creating: 'Đang tạo',
  'pending-approval': 'Chờ duyệt',
  manual: 'Đang làm tay',
  done: 'Hoàn thành',
};

export const InsuranceOrder = z.object({
  id: z.string(),
  /** DH-YYMM-NNN (spec P-12) — sinh lúc tạo, không đổi theo trạng thái sau đó. */
  orderCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  date: z.string(),
  product: z.string(),
  packageName: z.string(),
  status: InsuranceOrderStatus,
  source: InsuranceOrderSource,
  beneficiaryName: z.string(),
  beneficiaryDob: z.string(),
  beneficiaryIdNumber: z.string(),
  beneficiaryPhone: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  /** Phòng của người tạo lúc tạo — dùng để lọc theo phạm vi ở P-42, P-13. */
  createdByDepartmentId: z.string().nullable(),
});
export type InsuranceOrder = z.infer<typeof InsuranceOrder>;

/**
 * Người thụ hưởng: mặc định điền theo khách, sửa được thành người khác.
 * `product`/`packageName` cố định (từ món quà đã chọn) khi source = 'gift'.
 */
export const InsuranceOrderForm = z.object({
  customerId: z.string(),
  product: z.string().trim().min(1, 'Chưa chọn sản phẩm'),
  packageName: z.string().trim().min(1, 'Chưa chọn gói'),
  source: InsuranceOrderSource,
  date: z.string().trim().min(1, 'Chưa chọn ngày tạo'),
  beneficiaryName: z.string().trim().min(1, 'Chưa nhập tên người thụ hưởng'),
  beneficiaryDob: z.string(),
  beneficiaryIdNumber: z.string(),
  beneficiaryPhone: z.string(),
});
export type InsuranceOrderForm = z.infer<typeof InsuranceOrderForm>;

export const CreateInsuranceOrdersResult = z.object({
  orders: z.array(InsuranceOrder),
});
export type CreateInsuranceOrdersResult = z.infer<typeof CreateInsuranceOrdersResult>;

export async function createInsuranceOrder(
  form: InsuranceOrderForm,
  actorId: string,
): Promise<CreateInsuranceOrdersResult> {
  const res = await fetch('/api/insurance-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...form, actorId }),
  });
  if (!res.ok) throw new Error('Không tạo được đơn bảo hiểm này');
  return CreateInsuranceOrdersResult.parse(await res.json());
}

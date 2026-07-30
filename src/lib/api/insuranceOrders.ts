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

export const InsuranceOrder = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  date: z.string(),
  product: z.string(),
  packageName: z.string(),
  status: z.enum(['done', 'running', 'manual']),
  source: InsuranceOrderSource,
  beneficiaryName: z.string(),
  /** Phòng của người tạo lúc tạo — dùng để lọc theo phạm vi ở P-42. */
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

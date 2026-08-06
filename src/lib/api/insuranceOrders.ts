import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';

/**
 * Tạo đơn bảo hiểm — người thụ hưởng có thể KHÁC khách hàng (spec §5.4).
 *
 * Dựng để DÙNG LẠI: mở từ luồng Tặng quà (P-43, `source: 'gift'`, sản phẩm cố
 * định theo món đã chọn) hôm nay, và sẽ mở lại y hệt từ P-10/P-11 (tự khách
 * mua, `source: 'self'`, tự chọn sản phẩm) khi màn đó được xây.
 */

/**
 * TODO(P-10 Bảo hiểm, chờ module bảo hiểm): MỌI hàm trong file này gọi vào
 * `/api/insurance-orders*`, mà route đó CHƯA TỒN TẠI — gọi vào là 404.
 *
 * Luồng tặng quà ở `GiftGivingDialog` mở form người thụ hưởng được nhưng không
 * tạo nổi đơn. Gỡ mốc ở cả hai đầu khi dựng route.
 */

export const InsuranceOrderSource = z.enum(['self', 'gift']);
export type InsuranceOrderSource = z.infer<typeof InsuranceOrderSource>;

/**
 * Vòng đời đơn (spec §3.4):
 *
 * `queued` (Chờ tạo) — vừa nhận, CHƯA được hệ thống pick lên tạo. Mọi đơn mới
 * đều bắt đầu ở đây, không nhảy thẳng vào `creating`.
 * `queued` → `creating` (Đang tạo) → `pending-approval` (Chờ duyệt) →
 * `done` (Hoàn thành) là đường chính, do hệ thống tự chuyển.
 * Lỗi ở `creating` hoặc `pending-approval` → `manual-queued` (Chờ làm tay,
 * xếp hàng chờ người xử lý — P-15). Người xử lý nhận đơn → `manual-progress`
 * (Đang làm tay — P-16), xong bấm hoàn thành → `done`.
 */
export const InsuranceOrderStatus = z.enum([
  'queued',
  'creating',
  'pending-approval',
  'manual-queued',
  'manual-progress',
  'done',
]);
export type InsuranceOrderStatus = z.infer<typeof InsuranceOrderStatus>;

export const INSURANCE_STATUS_LABEL: Record<InsuranceOrderStatus, string> = {
  queued: 'Chờ tạo',
  creating: 'Đang tạo',
  'pending-approval': 'Chờ duyệt',
  'manual-queued': 'Chờ làm tay',
  'manual-progress': 'Đang làm tay',
  done: 'Hoàn thành',
};

/* Loại xe (`VEHICLE_TYPES`) nằm ở `@/lib/pvi` cùng toàn bộ hợp đồng field
   của PVI — nó là danh sách của PVI, không phải danh mục của mình. */

export const InsuranceOrder = z.object({
  id: z.string(),
  /** DH-YYMM-NNN (spec P-12) — sinh lúc tạo, không đổi theo trạng thái sau đó. */
  orderCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  /** Ngày bắt đầu hiệu lực. */
  date: z.string(),
  /** Ngày hết hiệu lực — null với đơn giả lập P-51/P-52 (không có khái niệm hiệu lực). */
  endDate: z.string().nullable(),
  product: InsuranceProduct,
  packageName: z.string(),
  /** Mức phí của ĐƠN này (đ) — prefill từ gói, sửa được từng đơn (03/08). */
  fee: z.number(),
  status: InsuranceOrderStatus,
  source: InsuranceOrderSource,
  beneficiaryName: z.string(),
  beneficiaryDob: z.string(),
  beneficiaryIdNumber: z.string(),
  beneficiaryPhone: z.string(),
  /** Địa chỉ người thụ hưởng — BH tai nạn điện theo HỘ nên địa chỉ là thông tin lõi (thêm 03/08). */
  beneficiaryAddress: z.string(),
  /** Chỉ có giá trị với đơn BH xe máy — rỗng với đơn khác. */
  licensePlate: z.string(),
  /** Loại xe, tự nhập ("Xe số", "Tay ga", "Xe điện"…) — chỉ đơn BH xe máy (thêm 03/08). */
  vehicleType: z.string(),
  /** Số khung — không bắt buộc, có khách không đọc được/không nhớ. */
  chassisNumber: z.string(),
  /** Số máy — không bắt buộc, cùng lý do với số khung. */
  engineNumber: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  /** Phòng của người tạo lúc tạo — dùng để lọc theo phạm vi ở P-42, P-13. */
  createdByDepartmentId: z.string().nullable(),
  /**
   * Ảnh chụp giấy chứng nhận bảo hiểm — THAY cho file PDF (không có PVI thật
   * để tải PDF). Có chỗ đính/xem ảnh này bất kể đơn đang ở trạng thái nào,
   * không chỉ khi đã hoàn thành.
   */
  certificatePhotoUrl: z.string().nullable(),
});
export type InsuranceOrder = z.infer<typeof InsuranceOrder>;

/**
 * Một đơn thật trong gói — người thụ hưởng để trống, KHÔNG mặc định theo
 * khách (có thể là người khác hẳn, mặc định sẵn thì hay gõ nhầm rồi phải xoá
 * lại). Có nút tự áp dụng thông tin khách vào form ở giao diện.
 * Một gói có thể sinh nhiều đơn, xem `insuranceOrderLegsFor`.
 */
export const InsuranceOrderLegForm = z
  .object({
    product: InsuranceProduct,
    packageName: z.string().trim().min(1, 'Chưa chọn gói'),
    fee: z.number().min(0, 'Mức phí phải từ 0 trở lên'),
    startDate: z.string().trim().min(1, 'Chưa chọn ngày bắt đầu'),
    endDate: z.string().trim().min(1, 'Chưa chọn ngày kết thúc'),
    beneficiaryName: z.string().trim().min(1, 'Chưa nhập tên người thụ hưởng'),
    beneficiaryDob: z.string(),
    beneficiaryIdNumber: z.string(),
    beneficiaryPhone: z.string(),
    beneficiaryAddress: z.string().trim().min(1, 'Chưa nhập địa chỉ'),
    licensePlate: z.string().trim(),
    vehicleType: z.string().trim(),
    chassisNumber: z.string().trim(),
    engineNumber: z.string().trim(),
  })
  // Biển số + loại xe bắt buộc CHỈ với BH xe máy — số khung/số máy luôn không
  // bắt buộc (khách hay không đọc được/không nhớ), gửi rỗng lên máy chủ nếu bỏ trống.
  .refine((leg) => leg.product !== 'motorbike' || leg.licensePlate.length > 0, {
    message: 'Chưa nhập biển số xe',
    path: ['licensePlate'],
  })
  .refine((leg) => leg.product !== 'motorbike' || leg.vehicleType.length > 0, {
    message: 'Chưa nhập loại xe',
    path: ['vehicleType'],
  });
export type InsuranceOrderLegForm = z.infer<typeof InsuranceOrderLegForm>;

export const InsuranceOrderForm = z.object({
  customerId: z.string(),
  source: InsuranceOrderSource,
  legs: z.array(InsuranceOrderLegForm).min(1, 'Chưa chọn gói'),
});
export type InsuranceOrderForm = z.infer<typeof InsuranceOrderForm>;

/**
 * ⚠️ ĐÃ BỎ (chốt 04/08): `InsuranceOrderLegGroup`, `insuranceOrderLegsFor`,
 * `productOf`, `yearsOf`.
 *
 * Bốn hàm đó suy ngược cấu trúc gói từ chuỗi `name` bằng bốn bộ luật parse:
 * `includes('xe máy')` ra sản phẩm, `/(\d+)\s*năm/` ra số năm, `split('+')` ra
 * số đơn, `/(\d+k)/` ra phí. Mà `name` là thứ CEO sửa được ở P-82 — đặt tên
 * "BH xe máy 3N" là regex trượt, âm thầm trả 1 năm, và một hợp đồng 3 năm bị
 * ghi ngày kết thúc sai hai năm.
 *
 * Nay cấu trúc khai tường minh ở `insurance_package_legs`: mỗi leg là *sản phẩm
 * gì · mấy năm · phí bao nhiêu*, và MỘT LEG = MỘT ĐƠN. Đọc `package.legs`,
 * đừng đọc tên gói.
 */

export const yearsLater = (date: string, years: number): string => {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
};

export const oneYearLater = (date: string): string => yearsLater(date, 1);

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

/**
 * Hai nút thao tác tay ở P-16: nhận đơn từ hàng chờ (`manual-queued` →
 * `manual-progress`), rồi đánh dấu hoàn thành (`manual-progress` → `done`).
 * Máy chủ tự kiểm bước chuyển hợp lệ, không nhận trạng thái tuỳ ý từ client.
 */
export async function setInsuranceOrderStatus(
  id: string,
  status: InsuranceOrderStatus,
  actorId: string,
): Promise<InsuranceOrder> {
  const res = await fetch(`/api/insurance-orders/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, actorId }),
  });
  if (!res.ok) throw new Error('Không đổi được trạng thái đơn này');
  return InsuranceOrder.parse(await res.json());
}

/** Đính/thay ảnh chứng nhận — dùng chung cho mọi trạng thái đơn. */
export async function setInsuranceOrderPhoto(
  id: string,
  photoUrl: string,
  actorId: string,
): Promise<InsuranceOrder> {
  const res = await fetch(`/api/insurance-orders/${id}/photo`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoUrl, actorId }),
  });
  if (!res.ok) throw new Error('Không lưu được ảnh chứng nhận này');
  return InsuranceOrder.parse(await res.json());
}

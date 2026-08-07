import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';

/**
 * Vòng đời và BIỂU MẪU của đơn bảo hiểm. Phần đọc (danh sách, chi tiết, các
 * hàm gọi API) nằm ở `insurance.ts` — file này cố ý không import file đó, để
 * `pvi.ts` và `customers.ts` lấy được enum mà không kéo theo vòng lặp import.
 *
 * Đơn dựng để DÙNG LẠI ở hai luồng: Tặng quà (P-43, `source: 'gift'`, gói cố
 * định) và khách tự mua (P-10/P-11 gộp vào P-13, `source: 'self'`).
 */

export const InsuranceOrderSource = z.enum(['self', 'gift']);
export type InsuranceOrderSource = z.infer<typeof InsuranceOrderSource>;

/**
 * Vòng đời đơn (spec §3.4):
 *
 * `queued` (Chờ tạo) — đơn nằm chờ BOT pick lên tạo.
 * `queued` → `creating` (Đang tạo) → `pending-approval` (Chờ duyệt) →
 * `done` (Hoàn thành) là nhánh chính, do hệ thống tự chuyển.
 * Lỗi ở `creating` hoặc `pending-approval` → `manual-queued` (Chờ làm tay,
 * xếp hàng chờ người xử lý), người xử lý nhận đơn → `manual-progress`
 * (Đang làm tay), xong bấm hoàn thành → `done`.
 *
 * TODO(P-13 Bảo hiểm, chờ bot PVI): bốn trạng thái của NHÁNH CHÍNH (`queued`,
 * `creating`, `pending-approval`, và `done` đi qua nhánh đó) hiện KHÔNG có
 * đường nào đi vào — chưa có bot nên đơn mới sinh thẳng ở `manual-queued`.
 * Ô lọc trạng thái ở P-13 vẫn liệt kê đủ sáu, và bốn cái đó luôn ra bảng rỗng.
 * Gỡ mốc này cùng lúc với mốc ở `createInsuranceOrders` (`server/insurance.ts`).
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

/**
 * Hai bước người xử lý tay bấm được ở P-14 (spec §3.5, §9.2).
 *
 * Máy chủ tự kiểm bước chuyển hợp lệ theo bảng §3.4 — nhận trạng thái tuỳ ý từ
 * client là bỏ qua cả vòng đời.
 */
export const MANUAL_STEPS = ['manual-progress', 'done'] as const;
export const InsuranceManualStep = z.enum(MANUAL_STEPS);
export type InsuranceManualStep = z.infer<typeof InsuranceManualStep>;

/* Loại xe (`VEHICLE_TYPES`) nằm ở `@/lib/pvi` cùng toàn bộ hợp đồng field
   của PVI — nó là danh sách của PVI, không phải danh mục của mình. */

/**
 * NGÀY CỦA ĐƠN — ngày nhân viên bán đơn cho khách.
 *
 * Ghi vào `insurance_orders.created_at`, và cột đó SỬA ĐƯỢC (chốt 07/08): hệ
 * thống sập hay mất mạng ngoài hiện trường thì hôm sau nhập bù vẫn ghi được
 * đúng ngày đã bán. Máy chủ chặn ngày tương lai — đơn của tuần sau thì chưa bán.
 *
 * Vết kiểm toán KHÔNG nằm ở cột này mà ở bảng `audit_log` (P-93), nơi ghi ai
 * sửa đơn nào lúc nào; cho sửa `created_at` không xoá dấu vết gì.
 */
const orderDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ');

/** Những trường một người nhập liệu gõ vào, dùng chung cho lúc tạo và lúc sửa. */
const orderFields = {
  orderDate,
  /** Mức phí của ĐƠN này (đ) — prefill từ gói, sửa được từng đơn (03/08). */
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
};

/**
 * Một đơn thật trong gói — người thụ hưởng để trống, KHÔNG mặc định theo
 * khách (có thể là người khác hẳn, mặc định sẵn thì hay gõ nhầm rồi phải xoá
 * lại). Có nút tự áp dụng thông tin khách vào form ở giao diện.
 * Một gói khai bao nhiêu leg thì sinh bấy nhiêu đơn.
 */
export const InsuranceOrderLegForm = z
  .object({
    product: InsuranceProduct,
    packageName: z.string().trim().min(1, 'Chưa chọn gói'),
    ...orderFields,
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
 * Sửa một đơn đã ghi. KHÔNG có `customerId`, `product`, `packageName`,
 * `source`: bốn thứ đó là DANH TÍNH của đơn — đổi chúng là biến bản ghi này
 * thành một đơn khác hẳn, và `packageName` còn là ảnh chụp danh mục lúc tạo.
 *
 * Là HÀM chứ không phải hằng vì luật biển số phụ thuộc sản phẩm, mà sản phẩm
 * không nằm trong biểu mẫu. Máy chủ gọi nó với sản phẩm ĐỌC TỪ DATABASE, nên
 * không nặn được: gửi lên `product: 'electric-accident'` cũng không gỡ được
 * ràng buộc biển số của một đơn xe máy.
 */
export const InsuranceOrderEditFields = z.object(orderFields);
export type InsuranceOrderEditForm = z.infer<typeof InsuranceOrderEditFields>;

export const insuranceOrderEditSchema = (product: InsuranceProduct) =>
  InsuranceOrderEditFields.refine(
    (form) => product !== 'motorbike' || form.licensePlate.length > 0,
    { message: 'Chưa nhập biển số xe', path: ['licensePlate'] },
  ).refine((form) => product !== 'motorbike' || form.vehicleType.length > 0, {
    message: 'Chưa nhập loại xe',
    path: ['vehicleType'],
  });

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

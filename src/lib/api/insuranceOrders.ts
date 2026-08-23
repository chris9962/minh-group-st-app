import { z } from 'zod';
import type { StatusTone } from '@/components/ui/StatusTag';
import { InsuranceProduct, isoDate, isoDateOrEmpty } from '@/lib/types';

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
 * `awaiting-certificate` (Đợi giấy chứng nhận) → `done` (Hoàn thành) là nhánh
 * chính, do hệ thống tự chuyển.
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
  /**
   * Duyệt xong bên PVI, còn đợi PVI sinh file giấy chứng nhận. Việc còn lại
   * không phải thao tác trên PVI — luồng 3 tải file rồi mới đẩy sang `done`.
   * Xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`.
   */
  'awaiting-certificate',
  'done',
]);
export type InsuranceOrderStatus = z.infer<typeof InsuranceOrderStatus>;

export const INSURANCE_STATUS_LABEL: Record<InsuranceOrderStatus, string> = {
  queued: 'Chờ tạo',
  creating: 'Đang tạo',
  'pending-approval': 'Chờ duyệt',
  'manual-queued': 'Chờ làm tay',
  'manual-progress': 'Đang làm tay',
  'awaiting-certificate': 'Đợi giấy chứng nhận',
  done: 'Hoàn thành',
};

/**
 * Tông màu của nhãn trạng thái, gom theo GIAI ĐOẠN chứ không theo ai làm
 * (chốt 2026-08-16).
 *
 * Ba nhóm: đang chờ · đang chạy · đã xong. Chờ bot hay chờ người thì với người
 * đọc bảng đều là "chưa ai đụng tới", nên chung một tông; tương tự, bot đang
 * chạy và người đang làm đều là "đang chạy".
 *
 * Bản trước hỏi `status === 'done'` nên năm trạng thái còn lại dùng chung nhãn
 * cảnh báo tam giác cam. Cả bảng đọc ra như đang có sự cố, và đúng những dòng
 * cần chú ý thì không nổi lên.
 *
 * Để ở đây cạnh `INSURANCE_STATUS_LABEL`: ba màn cùng vẽ nhãn này (P-13, P-14,
 * hồ sơ khách P-42), ba bảng ánh xạ rời nhau là ba chỗ sớm muộn lệch nhau.
 */
export const INSURANCE_STATUS_TONE: Record<InsuranceOrderStatus, StatusTone> = {
  queued: 'waiting',
  'manual-queued': 'waiting',
  creating: 'progress',
  'manual-progress': 'progress',
  // Đứng riêng một tông (chốt 2026-08-16): đây là chỗ đơn nằm lại chờ một quyết
  // định ở NGOÀI hệ thống, không phải hàng chờ của đội mình. Đơn đọng lâu ở đây
  // là đơn phải đi hỏi, nên nó cần nổi lên khỏi hai nhóm chờ và đang chạy.
  'pending-approval': 'review',
  // Cùng tông với `pending-approval`: đơn đang đợi một việc bên NGOÀI hệ thống
  // xong, ở đây là PVI sinh file. Đọng lâu là phải đi hỏi.
  'awaiting-certificate': 'review',
  done: 'ok',
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
 * NGÀY TẠO ĐƠN — ngày nhân viên thật sự lập đơn cho khách.
 *
 * Ghi vào cột riêng `insurance_orders.order_date` (chốt 07/08), cùng lối với
 * `bank_accounts.opened_date` và `services.service_date`. Hệ thống sập hay mất
 * mạng ngoài hiện trường thì hôm sau nhập bù vẫn ghi được đúng ngày đã làm.
 * Máy chủ chặn ngày tương lai — đơn của tuần sau thì chưa có.
 *
 * `created_at` KHÔNG đụng tới: nó vẫn là mốc bất biến "dòng dữ liệu ghi lúc
 * nào", và là thứ duy nhất còn đối chiếu được khi ngày tạo đơn bị sửa.
 *
 * ⚠️ Nhật ký truy vết P-93 hiện chỉ ghi "ai sửa đơn nào lúc nào", KHÔNG ghi giá
 * trị cũ và mới (`audit_log.detail` chưa có đường ghi). Nên một lượt kéo đơn từ
 * tháng 8 về tháng 6 để lại vết là có người sửa, chứ không nói kéo đi đâu.
 */
const orderDate = isoDate('Chưa chọn ngày tạo đơn');

/**
 * Những trường một người nhập liệu gõ vào, dùng chung cho lúc tạo và lúc sửa.
 *
 * Bốn ô ngày đi qua cùng một hàm kiểm. `startDate` / `endDate` / `beneficiaryDob`
 * trước đây không kiểm định dạng, nên `'05/08/2026'` xuống tới Postgres và ghi
 * thành `2026-05-08` — lệch ngày mà không báo lỗi.
 *
 * Máy chủ so `endDate < startDate` bằng phép so CHUỖI (`server/insurance.ts`).
 * Phép đó chỉ đúng khi cả hai ở dạng `YYYY-MM-DD`, và hàm kiểm này là thứ bảo
 * đảm điều đó.
 */
const orderFields = {
  orderDate,
  /** Mức phí của ĐƠN này (đ) — prefill từ gói, sửa được từng đơn (03/08). */
  fee: z.number().min(0, 'Mức phí phải từ 0 trở lên'),
  startDate: isoDate('Chưa chọn ngày bắt đầu'),
  endDate: isoDate('Chưa chọn ngày kết thúc'),
  beneficiaryName: z.string().trim().min(1, 'Chưa nhập tên người thụ hưởng'),
  /**
   * Ngày sinh người thụ hưởng — BẮT BUỘC với đơn tai nạn điện, bỏ trống với đơn
   * xe máy. Ràng buộc nằm ở `.refine` theo sản phẩm chứ không ở đây: form xe máy
   * không có ô này, siết thẳng thì mọi đơn xe máy đều báo thiếu.
   */
  beneficiaryDob: isoDateOrEmpty,
  /**
   * CCCD người thụ hưởng — BẮT BUỘC, trừ hai đường hợp lệ dưới đây. Cả hai đều
   * kiểm bằng `.refine` vì chúng phụ thuộc bối cảnh, không phụ thuộc kiểu:
   *
   *  1. Lúc TẠO, `beneficiaryIsCustomer` bật: người nhập không có
   *     `customer:access-id-number` chỉ thấy 4 số cuối CCCD của khách nên không
   *     có gì để điền, máy chủ tự lấy số đầy đủ từ DB (`createInsuranceOrders`).
   *  2. Lúc SỬA, máy chủ giấu CCCD với người không có phần trong đơn: form của
   *     họ nạp ô rỗng, và máy chủ cũng bỏ qua giá trị họ gửi lên.
   *
   * Đừng ràng buộc đủ 12 số — nó chặn đúng người đang dùng đường hợp lệ.
   */
  beneficiaryIdNumber: z.string(),
  beneficiaryPhone: z.string().trim().min(1, 'Chưa nhập số điện thoại'),
  beneficiaryAddress: z.string().trim().min(1, 'Chưa nhập địa chỉ'),
  /**
   * Hai ô của riêng đơn tai nạn điện — form PVI hỏi, đơn xe máy thì không.
   *
   * Không ràng buộc `min(1)` ở đây mà đẩy xuống `.refine` theo sản phẩm, cùng
   * lối với biển số xe: đơn xe máy gửi 0 là hợp lệ, chặn ở đây thì mọi đơn xe
   * máy đều báo thiếu một thứ form của họ không có.
   */
  /**
   * Message của `z.number()` là cho lỗi KIỂU, tách hẳn khỏi message của `min`.
   * Thiếu nó thì xoá trắng ô là `valueAsNumber` trả `NaN`, zod bắt lỗi kiểu và
   * in câu mặc định tiếng Anh của nó — `.refine` bên dưới không kịp chạy.
   */
  householdSize: z
    .number({ error: 'Chưa nhập số thành viên' })
    .min(0, 'Số thành viên không được là số âm'),
  sumInsured: z
    .number({ error: 'Chưa nhập số tiền bảo hiểm' })
    .min(0, 'Số tiền bảo hiểm không được là số âm'),
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
    /**
     * Người thụ hưởng CHÍNH LÀ khách của đơn — bật khi bấm "Điền theo khách hàng".
     *
     * Chỉ có ở luồng TẠO, không có ở luồng sửa: sửa một đơn đã ghi mà tự dẫn
     * xuất lại CCCD từ hồ sơ khách là viết lại hợp đồng theo dữ liệu hôm nay.
     *
     * Cần cờ tường minh chứ không suy từ "ô CCCD rỗng": đơn mua hộ người thân
     * cũng để trống ô đó, đoán nhầm là ghi CCCD của khách vào hợp đồng người khác.
     */
    beneficiaryIsCustomer: z.boolean(),
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
  })
  // Hai ô dưới đi ngược lại: bắt buộc với tai nạn điện, bỏ trống với xe máy.
  // Bot PVI dừng ở đúng hai ô này nếu chúng bằng 0, nên chặn ngay lúc nhập.
  .refine((leg) => leg.product !== 'electric-accident' || leg.householdSize > 0, {
    message: 'Chưa nhập số thành viên',
    path: ['householdSize'],
  })
  .refine((leg) => leg.product !== 'electric-accident' || leg.sumInsured > 0, {
    message: 'Chưa nhập số tiền bảo hiểm',
    path: ['sumInsured'],
  })
  // Ngày sinh: chỉ đơn tai nạn điện hỏi, và hỏi thì phải có.
  .refine((leg) => leg.product !== 'electric-accident' || leg.beneficiaryDob.length > 0, {
    message: 'Chưa chọn ngày sinh người thụ hưởng',
    path: ['beneficiaryDob'],
  })
  // CCCD: bỏ trống được ĐÚNG khi máy chủ sẽ tự lấy theo hồ sơ khách.
  .refine((leg) => leg.beneficiaryIsCustomer || leg.beneficiaryIdNumber.trim().length > 0, {
    message: 'Chưa nhập CCCD người thụ hưởng',
    path: ['beneficiaryIdNumber'],
  });
export type InsuranceOrderLegForm = z.infer<typeof InsuranceOrderLegForm>;

export const InsuranceOrderForm = z.object({
  customerId: z.string(),
  source: InsuranceOrderSource,
  legs: z.array(InsuranceOrderLegForm).min(1, 'Chưa chọn gói'),
  /**
   * Phòng ghi nhận bản ghi này. Chỉ người KHÔNG thuộc phòng nào mới phải chọn —
   * người có phòng thì máy chủ dùng phòng của họ và bỏ qua giá trị này.
   */
  departmentId: z.string(),
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

/**
 * `idHidden` = máy chủ đang giấu CCCD của đơn này với người sửa. Bắt buộc ô CCCD
 * mà không tính tới nó thì người không xem được số sẽ không lưu nổi thay đổi nào
 * — họ nạp ô rỗng, gõ gì vào máy chủ cũng bỏ qua (`updateInsuranceOrder`).
 */
export const insuranceOrderEditSchema = (product: InsuranceProduct, idHidden = false) =>
  InsuranceOrderEditFields.refine(
    (form) => product !== 'motorbike' || form.licensePlate.length > 0,
    { message: 'Chưa nhập biển số xe', path: ['licensePlate'] },
  )
    .refine((form) => product !== 'motorbike' || form.vehicleType.length > 0, {
      message: 'Chưa nhập loại xe',
      path: ['vehicleType'],
    })
    .refine((form) => product !== 'electric-accident' || form.householdSize > 0, {
      message: 'Chưa nhập số thành viên',
      path: ['householdSize'],
    })
    .refine((form) => product !== 'electric-accident' || form.beneficiaryDob.length > 0, {
      message: 'Chưa chọn ngày sinh người thụ hưởng',
      path: ['beneficiaryDob'],
    })
    .refine((form) => idHidden || form.beneficiaryIdNumber.trim().length > 0, {
      message: 'Chưa nhập CCCD người thụ hưởng',
      path: ['beneficiaryIdNumber'],
    })
    .refine((form) => product !== 'electric-accident' || form.sumInsured > 0, {
      message: 'Chưa nhập số tiền bảo hiểm',
      path: ['sumInsured'],
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

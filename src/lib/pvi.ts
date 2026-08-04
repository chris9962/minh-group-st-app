import type { InsuranceOrder } from './api/insuranceOrders';

/**
 * HỢP ĐỒNG TÍCH HỢP PVI — danh sách field trên form của PVI và giá trị của
 * mình điền vào đâu.
 *
 * ĐÂY LÀ TÀI LIỆU SỐNG, KHÔNG PHẢI CẤU HÌNH. Ai làm bot PVI đọc file này để
 * biết phải điền gì; ai làm form nhập liệu đọc để biết còn thiếu trường nào.
 * Để ở code (không đưa vào database) vì:
 *
 * - Field của PVI đổi thì **bot phải sửa code** mới điền được — thêm dòng
 *   trong database không làm bot biết điền field mới.
 * - Danh sách này là của PVI, mình không có quyền tự đặt ra. Cần lịch sử git
 *   để đối chiếu khi PVI đổi, cần review trước khi lên.
 * - Sai một mã là PVI từ chối đơn → đơn rơi vào `Chờ làm tay` → mất công
 *   người nhập tay. "Sửa cho tiện" ở đây đắt hơn một lần deploy nhiều.
 *
 * Ngược lại, những thứ SAU vẫn nằm ở database (xem mgst-db-design.md):
 * tài khoản đăng nhập PVI, ánh xạ gói bảo hiểm của mình sang mã sản phẩm PVI,
 * và các núm vặn vận hành (bật/tắt đẩy đơn, số lần thử lại).
 */

export type PviOption = { code: string; label: string };

/**
 * Loại xe — danh sách CỐ ĐỊNH của PVI (chụp từ chính form của họ).
 * Lưu `code` chứ không lưu nhãn: đó là thứ PVI nhận.
 */
export const VEHICLE_TYPES: readonly PviOption[] = [
  { code: '1001', label: 'Dưới 50 cc' },
  { code: '1002', label: 'Từ 50 cc trở lên' },
  { code: '1003', label: 'Xe máy điện' },
  { code: '2001', label: 'Xe mô tô ba bánh' },
  { code: '2002', label: 'Xe gắn máy và các loại xe cơ giới tương tự' },
];

export const vehicleTypeLabel = (code: string): string =>
  VEHICLE_TYPES.find((v) => v.code === code)?.label ?? code;

/* ── Định dạng & giá trị tự sinh ───────────────────────────────────── */

/**
 * ⚠️ CHƯA ĐỐI CHIẾU với form thật — đang đoán PVI dùng định dạng Việt Nam
 * `dd/MM/yyyy`. Mở form PVI xem một lần rồi sửa đúng ở ĐÂY, mọi field dùng
 * ngày tự đổi theo.
 */
export const pviDate = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

export const pviDateTime = (d: Date): string =>
  `${pviDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Thời điểm hiện tại cộng thêm N phút.
 *
 * Dùng cho các field PVI đòi mốc giờ tương lai gần (ví dụ hiệu lực bắt đầu
 * sau 30 phút). Bắt buộc là HÀM: gọi lúc điền đơn nên luôn ra giờ hiện tại —
 * viết thành hằng số thì nó đóng băng ở thời điểm nạp file, máy chủ chạy vài
 * ngày là đơn nào cũng mang giờ của lần khởi động gần nhất.
 */
export const nowPlusMinutes = (minutes: number): Date =>
  new Date(Date.now() + minutes * 60_000);

/**
 * Mức tin cậy của từng dòng — đọc bảng phải biết ngay chỗ nào chắc, chỗ nào
 * mới là phỏng đoán, để lúc gặp PVI còn biết hỏi cái gì.
 */
export type PviFieldStatus =
  /** Đã thấy tận mắt trên form PVI. */
  | 'confirmed'
  /** Mình đang thu thập và tin là PVI cần, CHƯA đối chiếu với form thật. */
  | 'assumed'
  /** PVI cần nhưng hệ thống mình CHƯA thu thập — phải bổ sung trước khi làm bot. */
  | 'missing';

export type PviField = {
  /** Định danh nội bộ để nói chuyện giữa các bên. */
  key: string;
  /** Nhãn trên form PVI — để đối chiếu bằng mắt khi mở form của họ. */
  label: string;
  /** Field này thuộc sản phẩm nào. */
  product: 'motorbike' | 'electric-accident' | 'both';
  required: boolean;
  /**
   * Kiểu ô nhập BÊN PVI — quyết định cách bot thao tác, không phải cách mình
   * hiển thị.
   *
   * `select` = thẻ chọn thường, đặt thẳng giá trị được.
   * `select-search` = ô chọn có Ô TÌM KIẾM bên trong: bot phải bấm mở → gõ vào
   * ô tìm → chờ danh sách lọc xong → mới bấm được dòng. Đặt thẳng giá trị như
   * `select` thường là hỏng. Phân biệt hai cái này để bot khỏi đứng im ở đúng
   * chỗ mà nhìn ảnh chụp thì tưởng đã chọn xong.
   */
  input: 'text' | 'date' | 'datetime' | 'number' | 'select' | 'select-search';
  /** Chỉ có với `input: 'select'` hoặc `'select-search'`. */
  options?: readonly PviOption[];
  /** Mô tả nguồn bằng tiếng Việt — dùng cho bảng đối chiếu với PVI. */
  source: string;
  /**
   * Lấy giá trị thật từ đơn. `null` = không lấy từ đơn — hoặc field này tự
   * sinh (xem `defaultValue`), hoặc CHƯA CÓ CHỖ NÀO CHỨA giá trị này và đó là
   * lỗ hổng phải bịt trước khi bot chạy được (`status: 'missing'`).
   */
  fill: ((order: InsuranceOrder) => string) | null;
  /**
   * Giá trị tự sinh, dùng khi `fill` không có hoặc trả về rỗng.
   *
   * PHẢI là hàm, không phải giá trị sẵn — nó được gọi ĐÚNG LÚC ĐIỀN ĐƠN. Ví dụ
   * `() => pviDateTime(nowPlusMinutes(30))` cho field hiệu lực bắt đầu sau 30
   * phút: viết thành hằng số thì giờ bị đóng băng ở lúc nạp file, máy chủ chạy
   * vài ngày là mọi đơn đều mang mốc giờ của lần khởi động gần nhất.
   */
  defaultValue?: () => string;
  status: PviFieldStatus;
  note?: string;
};

export const PVI_FIELDS: readonly PviField[] = [
  /* ── Người thụ hưởng — chung hai sản phẩm ─────────────────────────── */
  {
    key: 'hoTen',
    label: 'Họ tên người được bảo hiểm',
    product: 'both',
    required: true,
    input: 'text',
    source: 'Người thụ hưởng · Họ tên',
    fill: (o) => o.beneficiaryName,
    status: 'assumed',
  },
  {
    key: 'soDienThoai',
    label: 'Số điện thoại',
    product: 'both',
    required: true,
    input: 'text',
    source: 'Người thụ hưởng · Số điện thoại',
    fill: (o) => o.beneficiaryPhone,
    status: 'assumed',
  },
  {
    key: 'diaChi',
    label: 'Địa chỉ',
    product: 'both',
    required: true,
    input: 'text',
    source: 'Người thụ hưởng · Địa chỉ',
    fill: (o) => o.beneficiaryAddress,
    status: 'assumed',
  },

  /* ── Hợp đồng ─────────────────────────────────────────────────────── */
  {
    key: 'sanPham',
    label: 'Sản phẩm / gói bảo hiểm',
    product: 'both',
    required: true,
    input: 'select-search',
    source: 'Gói bảo hiểm đã chọn → mã sản phẩm bên PVI',
    fill: null,
    status: 'missing',
    note:
      'Mình mới có TÊN gói ("1 năm BH xe máy"), chưa có mã sản phẩm tương ứng ' +
      'bên PVI. Cần thêm cột `insurance_packages.pvi_product_code` — ánh xạ này ' +
      'phải ở database vì CEO thêm gói mới ở P-82 lúc nào cũng được.',
  },
  {
    key: 'ngayHieuLuc',
    label: 'Ngày bắt đầu hiệu lực',
    product: 'both',
    required: true,
    input: 'date',
    source: 'Đơn · Ngày bắt đầu',
    fill: (o) => o.date,
    status: 'assumed',
  },
  {
    key: 'ngayHetHan',
    label: 'Ngày kết thúc hiệu lực',
    product: 'both',
    required: true,
    input: 'date',
    source: 'Đơn · Ngày kết thúc',
    fill: (o) => o.endDate ?? '',
    status: 'assumed',
  },
  {
    key: 'mucPhi',
    label: 'Mức phí',
    product: 'both',
    required: true,
    input: 'number',
    source: 'Đơn · Mức phí',
    fill: (o) => String(o.fee),
    status: 'assumed',
    note: 'PVI có thể tự tính phí theo gói — nếu vậy field này chỉ để đối chiếu.',
  },

  /* ── BH tai nạn điện — định danh theo CCCD (spec §3.2) ────────────── */
  {
    key: 'cccd',
    label: 'Số CCCD',
    product: 'electric-accident',
    required: true,
    input: 'text',
    source: 'Người thụ hưởng · CCCD',
    fill: (o) => o.beneficiaryIdNumber,
    status: 'assumed',
  },
  {
    key: 'ngaySinh',
    label: 'Ngày sinh',
    product: 'electric-accident',
    required: true,
    input: 'date',
    source: 'Người thụ hưởng · Ngày sinh',
    fill: (o) => o.beneficiaryDob,
    status: 'assumed',
    note: 'Form BH xe máy đã bỏ ô này (03/08) — chỉ đơn tai nạn điện còn hỏi.',
  },

  /* ── BH xe máy — định danh theo GPLX (spec §3.2) ──────────────────── */
  {
    key: 'gplx',
    label: 'Số giấy phép lái xe',
    product: 'motorbike',
    required: true,
    input: 'text',
    source: '⚠️ chưa có ô nhập riêng',
    fill: null,
    status: 'missing',
    note:
      'Spec §3.2 ghi form BH xe máy định danh THEO GPLX, và §4.3 có luật kiểm ' +
      '"GPLX đúng độ dài" — nhưng form hiện tại chỉ có ô CCCD dùng chung cho cả ' +
      'hai sản phẩm. Phải hỏi PVI: đơn xe máy cần GPLX, CCCD, hay cả hai?',
  },
  {
    key: 'bienSo',
    label: 'Biển số xe',
    product: 'motorbike',
    required: true,
    input: 'text',
    source: 'Thông tin xe · Biển số',
    fill: (o) => o.licensePlate,
    status: 'assumed',
  },
  {
    key: 'loaiXe',
    label: 'Loại xe',
    product: 'motorbike',
    required: true,
    input: 'select-search',
    options: VEHICLE_TYPES,
    source: 'Thông tin xe · Loại xe',
    fill: (o) => o.vehicleType,
    status: 'confirmed',
    note:
      'Ô chọn CÓ tìm kiếm bên trong (thấy trên ảnh chụp form PVI) — bot phải mở ' +
      'rồi gõ vào ô tìm, không đặt thẳng giá trị được. Dòng hiển thị dạng ' +
      '"1001 - Dưới 50 cc", gõ mã số là lọc nhanh nhất.',
  },
  {
    key: 'soKhung',
    label: 'Số khung',
    product: 'motorbike',
    required: false,
    input: 'text',
    source: 'Thông tin xe · Số khung',
    fill: (o) => o.chassisNumber,
    status: 'assumed',
    note: 'Không bắt buộc — khách hay không đọc được / không nhớ.',
  },
  {
    key: 'soMay',
    label: 'Số máy',
    product: 'motorbike',
    required: false,
    input: 'text',
    source: 'Thông tin xe · Số máy',
    fill: (o) => o.engineNumber,
    status: 'assumed',
  },
];

/** Field áp dụng cho một sản phẩm cụ thể. */
export const pviFieldsFor = (product: 'motorbike' | 'electric-accident'): PviField[] =>
  PVI_FIELDS.filter((f) => f.product === 'both' || f.product === product);

/**
 * Field PVI cần mà hệ thống CHƯA thu thập được.
 *
 * Danh sách này còn dòng nào thì bot chưa chạy trọn vẹn được — nó sẽ đứng ở
 * đúng field đó. Kiểm trước khi bắt tay làm bot, đừng để phát hiện lúc chạy.
 */
export const missingPviFields = (): PviField[] =>
  PVI_FIELDS.filter((f) => f.fill === null && !f.defaultValue);

/**
 * Dựng sẵn dữ liệu để bot điền vào PVI.
 *
 * Máy chủ tính hộ, bot chỉ việc điền — bot không phải hiểu mô hình dữ liệu của
 * mình, và khi đổi tên trường bên mình thì sửa đúng một chỗ (file này).
 * Field còn thiếu (`fill === null`) trả về chuỗi rỗng kèm tên trong `missing`,
 * để bot biết mà dừng sớm thay vì gửi đơn thiếu.
 */
export function pviPayloadFor(order: InsuranceOrder): {
  values: Record<string, string>;
  missing: string[];
} {
  const product = order.product.includes('xe máy') ? 'motorbike' : 'electric-accident';
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of pviFieldsFor(product)) {
    // Lấy từ đơn trước; không có hoặc rỗng thì mới dùng giá trị tự sinh.
    const value = field.fill?.(order) || field.defaultValue?.() || '';
    if (value) values[field.key] = value;
    else if (field.required) missing.push(field.key);
  }

  return { values, missing };
}

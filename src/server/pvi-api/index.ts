/**
 * Cổng gọi API đối tác của PVI — CHỈ CHẠY Ở MÁY CHỦ.
 *
 * Module đọc `PVI_API_KEY` từ biến môi trường và ký MD5 tại chỗ. Import từ
 * component client là mang khoá bí mật xuống trình duyệt, nên mọi lệnh gọi
 * phải đi qua route handler hoặc server action.
 *
 * Tài liệu có 14 mục. Đã làm 4 (`API_Tham khao.docx` v1.0, 11/02/2026):
 *
 *   mục 10  `TaoDon_XeMay`      tạo đơn TNDS xe máy
 *   mục 11  `TaoDon_HSDD_CP`    tạo đơn tai nạn hộ sử dụng điện
 *   mục 13  callback            kiểm chữ ký PVI gửi tới (`verifyPviCallback`)
 *   mục 14  `GetPolicyNumber`   tra số giấy chứng nhận (`getPolicyNumber`)
 *
 * Mười mục còn lại — tính phí, danh mục, các sản phẩm ô tô — CHƯA làm.
 *
 * ⚠️ MỘT ĐƠN CÓ HAI MỐC. `Status "00"` của API tạo đơn chỉ nói PVI đã nhận và
 * đã gửi email cho khách; số giấy chứng nhận và link file PDF KHÔNG nằm trong
 * phản hồi đó. Mốc thứ hai tới qua một trong hai đường:
 *
 *   mục 13  PVI gọi vào `/api/pvi/callback`, tối đa 3 LẦN rồi thôi
 *   mục 14  mình chủ động tra bằng `ma_giaodich`
 *
 * Phải có cả hai. Chỉ dựa vào callback thì đơn nào hỏng đủ 3 lần là mất thông
 * tin, và tài liệu ghi lúc đó phải liên hệ TTCNTT PVI xử lý tay.
 *
 * Ba điểm còn phải hỏi PVI trước khi chạy đơn thật:
 *
 * 1. `Cpid` và `Key`: tài liệu để trống, chưa ai cấp.
 * 2. Chữ ký MD5 chữ hoa hay chữ thường — bật `PVI_API_SIGN_UPPERCASE=1` để thử.
 * 3. Chữ ký của `TaoDon_HSDD_CP` gọi tên `ma_gdich_doitac` và `Email`, class
 *    lại khai `ma_giaodich` và `email` — xem chú thích ở `electric.ts`.
 *
 * Toàn bộ đường dẫn trong tài liệu là môi trường TEST `piastest.pvi.com.vn` và
 * dùng `http`, không phải `https`. Chưa có URL chạy thật.
 */

export { readPviApiConfig, pviApiConfigured, type PviApiConfig } from "./config";
export { PviApiError, type PviApiErrorKind, type PviOrderResult } from "./client";
export {
  createMotorbikeOrder,
  buildMotorbikePayload,
  MotorbikeOrderInput,
  MotorbikeInvoice,
} from "./motorbike";
export {
  createElectricAccidentOrder,
  buildElectricPayload,
  ElectricOrderInput,
  ElectricParticipant,
} from "./electric";
export { getPolicyNumber, PolicyLookupInput, type PolicyLookupResult } from "./policy";
export { PVI_CERTIFICATE_EMAIL } from "./constants";
export { pviPeriod, type PviPeriod } from "./period";
export {
  verifyPviCallback,
  pviCallbackReply,
  PviCallbackBody,
  type PviCallbackCheck,
  type PviCertificate,
} from "./callback";

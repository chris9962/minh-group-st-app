import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readPviApiConfig } from "./config";
import { pviSignHex, pviText } from "./client";

/**
 * Mục 13 · Callback — PVI gọi VÀO hệ thống mình để báo giấy chứng nhận đã cấp.
 *
 * Ngược chiều mọi thứ còn lại trong thư mục này: ở đây mình là bên nhận, PVI là
 * bên ký. File này chỉ KIỂM và ĐỌC, không đụng database — route handler ở
 * `src/app/api/pvi/callback/route.ts` mới là nơi quyết định làm gì với dữ liệu.
 *
 * ⚠️ Chữ ký MD5 là cơ chế xác thực DUY NHẤT của đường này. Route công khai,
 * không có phiên đăng nhập. Ai biết `Key` thì giả được callback, nên `Key` phải
 * được giữ như mật khẩu và không bao giờ ghi ra log.
 *
 * ⚠️ PVI gọi tối đa 3 lần cho một `RequestId`. Hết 3 lần mà mình chưa nhận được
 * thì PVI bỏ luôn, phải liên hệ TTCNTT PVI xử lý tay. Hệ quả cho route:
 * chỉ trả `Status "00"` khi ĐÃ lưu xong. Trả "00" rồi mới lưu hỏng là mất lượt
 * gọi lại mà không có gì bù.
 */

/** Thân request PVI gửi tới, giữ nguyên tên trường của họ. */
export const PviCallbackBody = z.object({
  /** Id định danh người dùng phía đối tác — PVI gửi lại thứ mình từng gửi đi. */
  CardId: z.string().optional().default(""),
  SerialNumber: z.string().optional().default(""),
  RequestId: z.string().min(1),
  PolicyNumber: z.string().min(1),
  /** Đường dẫn file PDF giấy chứng nhận. */
  URL: z.string().min(1),
  CpId: z.string().optional().default(""),
  Sign: z.string().min(1),
});

export type PviCertificate = {
  /** `ma_giaodich` mình đã gửi lúc tạo đơn — khoá để tìm lại đơn bên mình. */
  requestId: string;
  policyNumber: string;
  serialNumber: string;
  url: string;
  cardId: string;
};

export type PviCallbackCheck =
  | { ok: true; data: PviCertificate }
  /** `status` là mã trả lại cho PVI, lấy đúng bảng mã lỗi của tài liệu. */
  | { ok: false; status: string; message: string };

/**
 * Kiểm một callback của PVI.
 *
 * Hàm thuần: không ghi log, không đụng mạng, không đụng database. Nhờ vậy test
 * được bằng một object, và route handler giữ trọn quyền quyết định.
 */
export function verifyPviCallback(body: unknown): PviCallbackCheck {
  const config = readPviApiConfig();
  if (!config) {
    return { ok: false, status: "-1", message: "Đối tác chưa cấu hình kết nối PVI" };
  }

  const parsed = PviCallbackBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: "-404", message: "Dữ liệu không hợp lệ" };
  }
  const b = parsed.data;

  // `CpId` rỗng thì bỏ qua vòng này — tài liệu không nói PVI có gửi hay không,
  // và chữ ký bên dưới mới là thứ thật sự chặn. Có gửi mà sai thì từ chối:
  // callback của đối tác khác không được rơi vào đơn của mình.
  if (b.CpId && b.CpId.trim() !== config.cpId) {
    return { ok: false, status: "-404", message: "CpId không khớp" };
  }

  /**
   * Ký trên giá trị NGUYÊN VĂN, không `.trim()`.
   *
   * PVI băm chuỗi họ gửi đi. Cắt dấu cách trước khi băm là băm một chuỗi khác
   * chuỗi họ đã băm, và mọi callback hợp lệ đều bị từ chối vì "sai chữ ký".
   * Chỉ cắt ở phần dữ liệu trả ra bên dưới.
   */
  const expected = pviSignHex(config, [b.RequestId, b.PolicyNumber, b.URL]);

  if (!sameSign(b.Sign, expected)) {
    return { ok: false, status: "-105", message: "Sai chữ ký" };
  }

  return {
    ok: true,
    data: {
      requestId: pviText(b.RequestId),
      policyNumber: pviText(b.PolicyNumber),
      serialNumber: pviText(b.SerialNumber),
      url: pviText(b.URL),
      cardId: pviText(b.CardId),
    },
  };
}

/**
 * So chữ ký bằng thời gian hằng số, không phân biệt hoa thường.
 *
 * `===` trên chuỗi thoát ngay ở byte lệch đầu tiên. Chênh lệch đó đo được, và
 * đủ để dò từng ký tự của một chữ ký hợp lệ mà không cần biết `Key`.
 * `timingSafeEqual` ném lỗi khi hai vế khác độ dài, nên chặn độ dài trước —
 * độ dài không phải bí mật, MD5 hex luôn 32 ký tự.
 */
function sameSign(received: string, expected: string): boolean {
  const a = Buffer.from(received.trim().toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Thân phản hồi tài liệu quy định đối tác phải trả: `{ Status, Message }`. */
export const pviCallbackReply = (status: string, message: string) => ({ Status: status, Message: message });

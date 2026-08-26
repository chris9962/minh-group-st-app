import { jsonBody } from "@/server/auth";
import { pviCallbackReply, verifyPviCallback } from "@/server/pvi-api";

/**
 * Mục 13 · Endpoint PVI gọi vào để báo giấy chứng nhận đã cấp.
 *
 * Khai đường dẫn này cho PVI: `https://<tên miền>/api/pvi/callback`.
 *
 * ⚠️ ROUTE CÔNG KHAI — không đòi phiên đăng nhập, vì bên gọi là máy chủ PVI chứ
 * không phải trình duyệt của nhân viên. Chữ ký MD5 trong thân request là cơ chế
 * xác thực duy nhất; `verifyPviCallback` kiểm nó trước mọi thứ khác.
 *
 * ⚠️ TRẢ `Status "00"` NGHĨA LÀ ĐÃ NHẬN XONG. PVI ngừng gọi lại `RequestId` này.
 * Vì vậy chỉ trả "00" sau khi đã lưu thành công. Lưu hỏng thì phải trả mã khác
 * để PVI gọi lại — họ cho tối đa 3 lần, hết thì phải liên hệ TTCNTT PVI xử lý
 * tay từng đơn.
 *
 * Luôn trả HTTP 200 kèm thân `{ Status, Message }`, kể cả khi từ chối. Tài liệu
 * PVI chỉ mô tả hợp đồng ở thân request; trả mã HTTP khác 200 thì client của họ
 * có thể không đọc `Status` và mình mất chỗ nói lý do.
 */

export async function POST(request: Request) {
  const check = verifyPviCallback(await jsonBody(request));

  if (!check.ok) {
    // Không ghi thân request ra log: nó mang `Sign`, và một callback giả cũng
    // đủ để bơm rác vào file log.
    console.warn(`[pvi-callback] từ chối: ${check.status} ${check.message}`);
    return Response.json(pviCallbackReply(check.status, check.message));
  }

  /**
   * TODO(pvi-api · callback mục 13, chờ chốt nơi lưu): CHƯA ghi `policyNumber`,
   * `serialNumber` và `url` vào đơn nào cả — dữ liệu chỉ đi vào log rồi mất.
   *
   * Gỡ mốc này khi có hàm ghi vào `insurance_orders` theo `requestId`. Hàm đó
   * PHẢI chịu được gọi lại nhiều lần với cùng `requestId` (PVI gọi tối đa 3
   * lần, và mình còn tự tra bằng `getPolicyNumber`), và phải ném lỗi khi ghi
   * hỏng để nhánh dưới trả mã lỗi cho PVI thay vì trả "00".
   */
  console.info(
    `[pvi-callback] nhận GCN cho ${check.data.requestId}: ${check.data.policyNumber}`,
  );

  return Response.json(pviCallbackReply("00", "Thanh cong"));
}

import { jsonBody } from "@/server/auth";
import { savePviCertificate } from "@/server/insurance";
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
 * Vì vậy chỉ trả "00" SAU KHI đã ghi vào database. Ghi hỏng thì trả mã khác để
 * PVI gọi lại — họ cho tối đa 3 lần, hết thì phải liên hệ TTCNTT PVI xử lý tay.
 *
 * Luôn trả HTTP 200 kèm thân `{ Status, Message }`, kể cả khi từ chối. Tài liệu
 * PVI chỉ mô tả hợp đồng ở thân request; trả mã HTTP khác 200 thì client của họ
 * có thể không đọc `Status` và mình mất chỗ nói lý do.
 */

export async function POST(request: Request) {
  const body = await jsonBody(request);

  // Ghi log NGAY khi có request, trước cả bước kiểm chữ ký. Lúc chạy thử với
  // PVI, câu hỏi đầu tiên là "họ có gọi không" — mà một callback sai chữ ký
  // hay sai cấu hình vẫn là bằng chứng họ đã gọi.
  //
  // Chỉ ghi hai mã định danh, KHÔNG ghi cả thân request: nó mang `Sign`, và
  // một callback giả cũng đủ để bơm rác vào file log.
  const from = request.headers.get("x-forwarded-for") ?? "?";
  const seen = body as { RequestId?: unknown; PolicyNumber?: unknown } | null;
  console.info(
    `[pvi-callback] nhận request từ ${from}` +
      ` · RequestId=${String(seen?.RequestId ?? "")}` +
      ` · PolicyNumber=${String(seen?.PolicyNumber ?? "")}`,
  );

  const check = verifyPviCallback(body);

  if (!check.ok) {
    console.warn(`[pvi-callback] từ chối: ${check.status} ${check.message}`);
    return Response.json(pviCallbackReply(check.status, check.message));
  }

  const { requestId, policyNumber, serialNumber, url } = check.data;

  let saved: boolean;
  try {
    saved = await savePviCertificate(requestId, { url, serialNumber });
  } catch (cause) {
    // Ghi hỏng thì PVI phải gọi lại — trả `-1` chứ không phải `00`.
    console.error(`[pvi-callback] ghi hỏng ${requestId}:`, cause);
    return Response.json(pviCallbackReply("-1", "Lỗi ghi dữ liệu, gửi lại giúp"));
  }

  if (!saved) {
    console.warn(`[pvi-callback] không có đơn nào mang mã ${requestId}`);
    return Response.json(pviCallbackReply("-404", "Không tìm thấy đơn mang RequestId này"));
  }

  console.info(`[pvi-callback] ${requestId} nhận GCN ${policyNumber}`);
  return Response.json(pviCallbackReply("00", "Thanh cong"));
}

import { z } from "zod";
import { readPviApiConfig } from "./config";
import { PviApiError, pviRequest, pviSign, pviText } from "./client";

/**
 * Mục 14 · `GetPolicyNumber` — tra thông tin giấy chứng nhận của một đơn.
 *
 * Hai lúc phải dùng:
 *
 * 1. Callback (mục 13) không tới. PVI chỉ gọi callback tối đa 3 lần rồi thôi,
 *    nên đơn nào quá hạn mà chưa có `policyNumber` thì phải tự tra.
 * 2. `createXOrder` ném lỗi `network`. Lúc đó KHÔNG biết PVI đã ghi đơn hay
 *    chưa — tra `ma_giaodich` cũ trước, có kết quả thì đừng tạo lại.
 *
 * ⚠️ Việc 2 KHÔNG dùng hàm này được. Đo thật trên `piastest` ngày 2026-09-03:
 * đơn vừa tạo xong trả `-500 Khong ton tai requestId`, tra lại sau vài phút mới
 * trả `Status 00` kèm số giấy chứng nhận. Trong khoảng chờ đó, `-500` không
 * phân biệt "PVI chưa cấp giấy chứng nhận" với "không có đơn nào mang mã này" —
 * mà đúng khoảng đó là lúc cần biết. Đọc nó ra quyết định tạo lại là ra hai đơn
 * cho một khách. Dùng `-555 Mã giao dịch đã tồn tại` của chính API tạo đơn: gửi
 * lại cùng `ma_giaodich`, PVI trả `-555` thì đơn cũ đã ghi.
 */

export const PolicyLookupInput = z.object({
  /**
   * Chính là `ma_giaodich` đã gửi lúc tạo đơn. Tài liệu chú thích ngay trong
   * class tạo đơn: `public string ma_giaodich // RequestId la duy nhat`.
   */
  requestId: z.string().trim().min(1),
});
export type PolicyLookupInput = z.infer<typeof PolicyLookupInput>;

export type PolicyLookupResult = {
  requestId: string;
  /** Số giấy chứng nhận điện tử. Rỗng khi PVI chưa cấp xong. */
  policyNumber: string;
  /**
   * Số IN TRÊN GIẤY của đơn tai nạn điện, `26/21/14/TNCN/P013011`. Khác
   * `policyNumber`. Đơn xe máy thì rỗng, giấy của nó in `serialNumber`.
   * Đo 2026-09-11, xem ghi chú ở cột `pvi_policy_gcn`.
   */
  policyGcn: string;
  serialNumber: string;
  /** Đường dẫn file PDF giấy chứng nhận. Rỗng khi chưa cấp xong. */
  url: string;
  /** `true` khi đã có ĐỦ số giấy chứng nhận và file — mốc "đơn hoàn tất". */
  issued: boolean;
};

/**
 * Gọi `GetPolicyNumber`.
 *
 * `Status "00"` chỉ nói lệnh gọi chạy được, KHÔNG nói giấy chứng nhận đã cấp.
 * PVI trả `PolicyNumber` rỗng cho đơn đã nhận mà chưa cấp xong, nên nơi gọi
 * đọc `issued` chứ đừng đọc `status`.
 *
 * Đơn không tồn tại thì PVI trả mã khác `00`, và hàm ném `PviApiError` kind
 * `business` — đó là câu trả lời "chưa có đơn nào mang mã giao dịch này".
 */
export async function getPolicyNumber(input: PolicyLookupInput): Promise<PolicyLookupResult> {
  const { requestId } = PolicyLookupInput.parse(input);

  const config = readPviApiConfig();
  if (!config) {
    throw new PviApiError({
      kind: "config",
      endpoint: "GetPolicyNumber",
      message: "Chưa cấu hình PVI_API_CPID / PVI_API_KEY trong .env.local",
    });
  }

  const { raw } = await pviRequest("GetPolicyNumber", {
    CpId: config.cpId,
    Sign: pviSign(config, [requestId]),
    RequestId: requestId,
  });

  const policyNumber = pviText(raw.PolicyNumber as string);
  const url = pviText(raw.URL as string);

  return {
    // Lấy `RequestId` PVI trả về chứ không chép lại tham số đầu vào: hai giá
    // trị lệch nhau là dấu hiệu PVI tra nhầm đơn, và nơi gọi phải thấy được.
    requestId: pviText(raw.RequestId as string) || requestId,
    policyNumber,
    policyGcn: pviText(raw.Policy_GCN as string),
    serialNumber: pviText(raw.SerialNumber as string),
    url,
    issued: policyNumber !== "" && url !== "",
  };
}

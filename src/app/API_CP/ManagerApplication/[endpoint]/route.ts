import { timingSafeEqual } from "node:crypto";
import { pviEndpointUrl, readPviApiEnv } from "@/server/pvi-api/config";

/**
 * Chuyển tiếp lệnh gọi API đối tác PVI, để máy cá nhân chạy thử được.
 *
 * PVI chặn theo IP và chỉ whitelist máy chủ chạy thật. Không có đường này thì
 * mọi lần chạy thử phải SSH vào máy chủ.
 *
 * Đường dẫn proxy cố định `/API_CP/ManagerApplication/<endpoint>`, theo khuôn
 * bản test của PVI. Máy cá nhân đặt `PVI_API_PROXY_ORIGIN=https://app.mgst.com.vn`
 * là gọi qua đây; máy chủ chuyển tiếp tới bản test hay bản thật theo
 * `PVI_API_ENV` của chính nó, vì hai bản khác cả tên miền lẫn đường dẫn.
 *
 * ⚠️ ROUTE CÔNG KHAI, và nó tạo đơn THẬT trên PVI. Hai điều kiện kiểm tra:
 * `PVI_PROXY_TOKEN` phải đặt trên máy chủ, và người gọi phải gửi đúng chuỗi đó ở
 * header `x-pvi-proxy-token`. Biến rỗng thì route trả 404 như không tồn tại.
 *
 * ⚠️ TẮT ĐI khi chạy thử xong: xoá `PVI_PROXY_TOKEN` rồi dựng lại container.
 */

/**
 * Bốn lệnh gọi bên mình dùng. Không mở cả `ManagerApplication`: danh sách trắng
 * chặn được lượt gọi tới mục PVI mà mình chưa đọc tài liệu.
 */
const ALLOWED = new Set([
  "TaoDon_XeMay",
  "TaoDon_HSDD_CP",
  "GetPolicyNumber",
  "Get_DanhMuc",
]);

const MAX_BODY_BYTES = 64 * 1024;

/** So chuỗi không phụ thuộc thời gian, để không lộ token qua thời gian phản hồi. */
function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () => new Response("Not found", { status: 404 });

type Params = { params: Promise<{ endpoint: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = (process.env.PVI_PROXY_TOKEN ?? "").trim();
  if (!token) return notFound();

  const given = request.headers.get("x-pvi-proxy-token") ?? "";
  if (!sameToken(given, token)) return notFound();

  const { endpoint } = await params;
  if (!ALLOWED.has(endpoint)) return notFound();

  // Máy chủ PVI chọn theo `PVI_API_ENV` của MÁY CHỦ, không theo máy gọi: hai
  // môi trường khác cả tên miền lẫn đường dẫn, xem `PVI_ENDPOINT_PREFIX`.
  const env = readPviApiEnv();

  // Chuyển tiếp thân request NGUYÊN VĂN, không parse rồi dựng lại. Chữ ký MD5
  // của PVI băm đúng chuỗi mình gửi, nên một lần `JSON.stringify` lại là đủ đổi
  // thứ tự trường và ra `-105 Sai chữ ký`.
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return notFound();

  const timeout = Number(process.env.PVI_API_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000;

  console.info(`[pvi-proxy] ${env} ${endpoint} · ${body.length} byte`);

  let response: Response;
  try {
    response = await fetch(pviEndpointUrl(env, endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.error(`[pvi-proxy] ${endpoint} không gọi được: ${reason}`);
    return Response.json({ Status: "-1", Message: `Proxy không gọi được PVI: ${reason}` });
  }

  // Trả nguyên mã HTTP và thân phản hồi. Máy gọi phải thấy đúng thứ PVI trả về,
  // kể cả thân không phải JSON — đó là lúc cần đọc nguyên văn nhất.
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
  });
}

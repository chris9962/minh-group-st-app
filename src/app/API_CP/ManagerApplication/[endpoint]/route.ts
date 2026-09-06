import { timingSafeEqual } from "node:crypto";

/**
 * Chuyển tiếp lệnh gọi API đối tác PVI, để máy cá nhân chạy thử được.
 *
 * PVI chặn theo IP và chỉ whitelist máy chủ chạy thật. Không có đường này thì
 * mọi lần chạy thử phải SSH vào máy chủ.
 *
 * Đường dẫn cố ý trùng KHUÔN của PVI: `/API_CP/ManagerApplication/<endpoint>`.
 * Nhờ vậy máy cá nhân chỉ đổi `PVI_API_BASE_URL` sang tên miền của mgst-app là
 * chạy, không sửa dòng code nào. Lúc triển khai thật thì đổi biến đó về tên miền
 * PVI, proxy không còn nằm trên đường đi.
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

  const baseUrl = (process.env.PVI_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return Response.json({ Status: "-1", Message: "Máy chủ chưa cấu hình PVI_API_BASE_URL" });
  }

  // Chuyển tiếp thân request NGUYÊN VĂN, không parse rồi dựng lại. Chữ ký MD5
  // của PVI băm đúng chuỗi mình gửi, nên một lần `JSON.stringify` lại là đủ đổi
  // thứ tự trường và ra `-105 Sai chữ ký`.
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return notFound();

  const timeout = Number(process.env.PVI_API_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000;

  console.info(`[pvi-proxy] ${endpoint} · ${body.length} byte`);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/API_CP/ManagerApplication/${endpoint}`, {
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

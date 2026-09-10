import { timingSafeEqual } from "node:crypto";

/**
 * Tải hộ một file của PVI cho máy cá nhân — cùng lý do với proxy ở
 * `src/app/API_CP/ManagerApplication/[endpoint]`.
 *
 * Địa chỉ giấy chứng nhận mà `GetPolicyNumber` trả về trỏ thẳng sang máy chủ
 * PVI, nên proxy kia không phủ. Không có đường này thì máy cá nhân chạy được
 * bước tạo đơn mà mắc ở bước tải file.
 *
 * ⚠️ ROUTE CÔNG KHAI. Hai điều kiện kiểm tra, cùng khuôn với proxy kia:
 * `PVI_PROXY_TOKEN` phải đặt trên máy chủ, và người gọi phải gửi đúng chuỗi đó ở
 * header `x-pvi-proxy-token`. Biến rỗng thì route trả 404 như không tồn tại.
 *
 * ⚠️ CHỈ tải được từ tên miền `*.pvi.com.vn`. Không có điều kiện đó thì route
 * thành một đường để người ngoài bắt máy chủ gọi tới địa chỉ bất kỳ.
 */

const MAX_BYTES = 20 * 1024 * 1024;

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: Request) {
  const token = (process.env.PVI_PROXY_TOKEN ?? "").trim();
  if (!token) return notFound();
  if (!sameToken(request.headers.get("x-pvi-proxy-token") ?? "", token)) return notFound();

  const target = new URL(request.url).searchParams.get("url") ?? "";
  if (!target) return notFound();

  let wanted: URL;
  try {
    wanted = new URL(target);
  } catch {
    return notFound();
  }
  // Chỉ tải từ máy chủ của PVI. Link giấy chứng nhận mà `GetPolicyNumber` trả
  // về không nhất thiết cùng tên miền với API, nên kiểm theo đuôi tên miền.
  if (!wanted.hostname.endsWith(".pvi.com.vn")) return notFound();

  let response: Response;
  try {
    response = await fetch(wanted, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.error(`[pvi-file] không tải được ${wanted.pathname}: ${reason}`);
    return new Response(`Proxy không tải được file: ${reason}`, { status: 502 });
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) return new Response("File quá lớn", { status: 502 });

  console.info(`[pvi-file] ${wanted.pathname} · ${bytes.length} byte · HTTP ${response.status}`);

  // Trả nguyên mã HTTP và nguyên byte. Nơi gọi tự nhận ra PDF hay trang HTML
  // "chưa sinh file" — đó là cách phân biệt duy nhất PVI cho.
  return new Response(new Uint8Array(bytes), {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}

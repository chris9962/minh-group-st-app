import { ClientErrorBody } from "@/lib/api/clientErrors";
import { badRequest, jsonBody, signedIn } from "@/server/auth";
import { logClientError } from "@/server/clientErrors";

/** Trần cỡ `detail` sau khi đổi ra JSON: đây là dữ liệu máy người dùng gửi lên, không cho ghi tuỳ ý. */
const MAX_DETAIL_CHARS = 4000;

/**
 * Ghi một lỗi phía trình duyệt vào `client_errors` (chốt 2026-10-09). Ai đăng
 * nhập cũng ghi được; `user_agent` lấy từ header của chính request này.
 */
export async function POST(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const parsed = ClientErrorBody.safeParse(await jsonBody(request));
  if (!parsed.success || JSON.stringify(parsed.data.detail).length > MAX_DETAIL_CHARS) return badRequest();

  await logClientError(guard.actor, parsed.data, request.headers.get("user-agent") ?? "");
  return new Response(null, { status: 204 });
}

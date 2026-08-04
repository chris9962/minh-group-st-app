import { destroySession } from "@/server/auth";

/** C-01 · Đăng xuất — luôn trả 204, kể cả khi phiên đã hết hạn từ trước. */
export async function POST(request: Request) {
  const cookie = await destroySession(request);
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie } });
}

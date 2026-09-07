import { signedIn } from "@/server/auth";

/**
 * Bộ quyền HIỆN TẠI của chính người đang gọi.
 *
 * Trình duyệt giữ `User` lúc đăng nhập trong localStorage, nên ai được đổi
 * quyền sau đó vẫn thấy nút theo bộ cũ. Khung app gọi đường này lúc mở và mỗi
 * lần quay lại tab để nạp lại; nhận 401 nghĩa là phiên đã bị xoá vì đổi quyền
 * (xem `updateStaff`) hoặc hết hạn, và khung app đưa về màn đăng nhập.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(guard.actor);
}

import { signedIn } from "@/server/auth";
import { listReferenceProvinces } from "@/server/catalog";

/**
 * 34 tỉnh/thành theo dữ liệu nhà nước — chỉ đọc, dữ liệu tham chiếu dùng chung.
 *
 * Chỉ cần đăng nhập (đổi từ `configure-catalog`, 2026-08-27): ngoài P-71, ô
 * chọn tỉnh của hộp thoại mã giới thiệu P-61 cũng đọc danh sách này, mà người
 * quản mã ngân hàng không có quyền catalog — cùng lối nghĩ với `signedIn`.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listReferenceProvinces());
}

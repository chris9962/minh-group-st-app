import { signedIn } from "@/server/auth";
import { lookupCustomers } from "@/server/customers";

/**
 * Ô tìm khách của ba hộp thoại tạo bản ghi: Mở tài khoản, Tạo đơn bảo hiểm,
 * Ghi dịch vụ.
 *
 * Route RIÊNG với bảng P-40, tách 2026-08-23. Bản trước dùng chung
 * `/api/customers` và phân biệt hai đường bằng tham số `mine=1` do trình duyệt
 * gửi — nghĩa là bỏ tham số đó khỏi URL là đọc được cả kho, kể cả người mà bảng
 * P-40 chỉ cho thấy một phòng. Cờ do phía gọi gửi không phải phân quyền
 * (AGENTS.md §6).
 *
 * Đường này mở toàn công ty theo spec §2.1b, nhưng chỉ trả id, tên và số điện
 * thoại, tối đa 15 dòng, không phân trang. Đủ để nhận ra người cần chọn, không
 * đủ để kéo danh bạ khách hàng của công ty về máy.
 *
 * Chặn ở mức đã đăng nhập, không hỏi quyền `customer:view-detail`: ai tạo được
 * bản ghi thì phải chọn được khách, mà quyền tạo nằm ở ba module khác nhau.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams.get("search") ?? "";
  return Response.json(await lookupCustomers(search));
}

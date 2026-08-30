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
 * Đường này áp đúng phạm vi `customer:view-detail` của người đang đăng nhập:
 * khách mình lập, khách của các phòng mình quản, hoặc toàn công ty nếu được cấp
 * quyền đó. Chỉ trả id, tên và số điện thoại, tối đa 15 dòng, không phân trang.
 *
 * Chặn ở mức đã đăng nhập; hàm server phía dưới tự áp quyền
 * `customer:view-detail` lên từng kết quả.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const search = params.get("search") ?? "";
  /**
   * `for=bank-account` bỏ khách đã đủ trần tài khoản khỏi danh sách, và trả kèm
   * số khách bị bỏ. Lọc ở máy chủ chứ không ở trình duyệt (AGENTS.md §5.1): số
   * dòng trả về đã cắt ở 15, lọc sau khi cắt là danh sách trống trong khi kho
   * vẫn còn người chọn được.
   */
  const forBankAccount = params.get("for") === "bank-account";
  return Response.json(await lookupCustomers(guard.actor, search, { forBankAccount }));
}

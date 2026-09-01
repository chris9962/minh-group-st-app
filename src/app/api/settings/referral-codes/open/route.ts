import { actorWith, uuidParam } from "@/server/auth";
import { AccountType } from "@/lib/api/bankAccounts";
import { listOpenReferralCodes } from "@/server/catalog";
import { departmentForNewRecord } from "@/server/writeDepartment";

/**
 * Mã còn chỗ của MỘT ngân hàng — nguồn cho ô chọn mã lúc KD mở tài khoản.
 *
 * Tách khỏi `/referral-codes` (bảng P-61, luôn phân trang) vì hai câu hỏi khác
 * nhau: bảng cần xem cả kho từng trang một, ô chọn cần trọn danh sách còn dùng
 * được. Nhét chung một route thì phải mở đường "lấy hết", mà đường đó là chỗ
 * mọi màn sau này lách phân trang.
 *
 * Quyền theo `create` của module ngân hàng, KHÔNG phải `manage-referral-codes`:
 * KD mở tài khoản thì được chọn mã, nhưng không được vào kho mã.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "banking", "create");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const bankId = uuidParam(params.get("bankId"));
  // Không có ngân hàng hoặc id sai dạng thì không có mã nào để chọn.
  if (!bankId) return Response.json([]);

  /**
   * Lọc theo PHÒNG GHI NHẬN của bản ghi sắp tạo (spec §4.4d), qua đúng hàm mà
   * `startBankAccount` dùng — hai nơi lệch luật thì ô chọn bày ra mã mà bấm vào
   * bị từ chối.
   *
   * Người chưa chọn phòng chỉ thấy mã `all`: đây là danh sách để chọn, chưa
   * phải lượt ghi, nên trả rỗng cả danh sách là chặn quá tay.
   */
  const department = departmentForNewRecord(guard.actor, "banking", uuidParam(params.get("departmentId")));
  const accountType = AccountType.safeParse(params.get("accountType"));

  return Response.json(
    await listOpenReferralCodes(
      bankId,
      department.ok ? (department.departmentId ?? "") : "",
      accountType.success ? accountType.data : "",
    ),
  );
}

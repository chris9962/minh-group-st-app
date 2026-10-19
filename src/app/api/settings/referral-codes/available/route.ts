import { forbidden, signedIn } from "@/server/auth";
import { canSeeAvailableReferralCodes, recordVisibility } from "@/lib/permissions";
import { listAvailableReferralCodes } from "@/server/catalog";

/**
 * Mã còn chỗ của mọi ngân hàng trong PHẠM VI người xem — nguồn cho nút MGT ở
 * màn Ngân hàng P-21 (chốt 2026-10-15). Không phân trang: một phòng chỉ có
 * vài chục mã còn chỗ.
 *
 * Phạm vi lấy từ `banking:view-detail`, cùng hàm với bảng tài khoản: Trưởng
 * phòng thấy mã phòng mình dùng được, Ban giám đốc thấy cả kho. Nhân viên bị
 * từ chối, cùng điều kiện với nút trên giao diện (`canSeeAvailableReferralCodes`).
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  if (!canSeeAvailableReferralCodes(guard.actor)) return forbidden();

  const visibility = recordVisibility(guard.actor, "banking", "view-detail");
  // `all=1` = thấy cả mã đã đầy và đã ngừng (ô tích trong modal, chốt 2026-10-19).
  const all = new URL(request.url).searchParams.get("all") === "1";
  return Response.json(
    await listAvailableReferralCodes(
      visibility.kind === "departments" ? visibility.departmentIds : null,
      !all,
    ),
  );
}

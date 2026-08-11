import { INSURANCE_SORT } from "@/lib/api/insurance";
import { can } from "@/lib/permissions";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listInsuranceOrders } from "@/server/insurance";
import { pageArgsFrom } from "@/server/pagination";

/** P-13 · MỘT trang đơn bảo hiểm. Lọc/tìm/sắp/cắt trang đều ở máy chủ. */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // Chốt này không thừa: `recordVisibility` thiếu `can()` thì rơi về `own` và
  // ai đăng nhập cũng đọc được đơn của chính mình dù không có quyền nào.
  if (!can(actor, "insurance", "view-detail")) return forbidden();

  const url = new URL(request.url);
  const params = url.searchParams;

  return Response.json(
    await listInsuranceOrders(
      actor,
      {
        search: params.get("search") ?? "",
        // Trạng thái và sản phẩm là enum — chuỗi lạ rơi về "tất cả", không 400.
        status: params.get("status") ?? "",
        product: params.get("product") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500. Bỏ qua bộ
        // lọc hỏng chứ đừng làm vỡ cả màn.
        staffId: uuidParam(params.get("staffId")),
        staffRole: params.get("staffRole") ?? "any",
      },
      pageArgsFrom(url, INSURANCE_SORT, "date"),
    ),
  );
}

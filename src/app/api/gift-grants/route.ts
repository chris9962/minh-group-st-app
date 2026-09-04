import { GIFT_GRANT_SORT } from "@/lib/api/gifts";
import { can } from "@/lib/permissions";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listGiftGrants } from "@/server/gift";
import { pageArgsFrom } from "@/server/pagination";

/**
 * P-44 · Quà đã phát cho khách, mọi phòng trong phạm vi người xem.
 *
 * Gác bằng `banking:view-detail`, KHÔNG bằng `banking:grant-gift`: quyền kia là
 * quyền PHÁT quà, còn đây là màn đọc. Quà sinh ra từ combo tài khoản ngân hàng
 * nên phạm vi đi theo đúng module đó.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "view-detail")) return forbidden();

  const url = new URL(request.url);
  const params = url.searchParams;

  return Response.json(
    await listGiftGrants(
      actor,
      {
        search: params.get("search") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500.
        departmentId: uuidParam(params.get("departmentId")),
        staffId: uuidParam(params.get("staffId")),
      },
      pageArgsFrom(url, GIFT_GRANT_SORT, "date"),
    ),
  );
}

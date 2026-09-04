import { BANK_ACCOUNT_SORT } from "@/lib/api/banking";
import { can } from "@/lib/permissions";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listBankAccounts } from "@/server/banking";
import { pageArgsFrom } from "@/server/pagination";

/**
 * P-21 · Danh sách tài khoản ngân hàng.
 *
 * Phạm vi do máy chủ tự kẹp theo quyền người gọi — KHÔNG nhận `scope` hay
 * `actorId` từ đường truyền.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // `clampScope` một mình rơi về `own`, mà `own` là CẢ PHÒNG — thiếu chốt này
  // thì ai đăng nhập cũng đọc được tài khoản của đồng nghiệp.
  if (!can(actor, "banking", "view-detail")) return forbidden();

  const url = new URL(request.url);
  const params = url.searchParams;

  return Response.json(
    await listBankAccounts(
      actor,
      {
        search: params.get("search") ?? "",
        bankCode: params.get("bankCode") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        referralCode: params.get("referralCode") ?? "",
        // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500.
        channelId: uuidParam(params.get("channelId")),
        staffId: uuidParam(params.get("staffId")),
        departmentId: uuidParam(params.get("departmentId")),
        status: params.get("status") ?? "",
        accountType: params.get("accountType") ?? "",
      },
      pageArgsFrom(url, BANK_ACCOUNT_SORT, "date"),
    ),
  );
}

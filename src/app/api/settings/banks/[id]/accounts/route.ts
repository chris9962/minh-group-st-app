import { BANK_ACCOUNT_SORT } from "@/lib/api/banking";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized, uuidParam } from "@/server/auth";
import { listBankAccountsOfBank } from "@/server/banking";
import { pageArgsFrom } from "@/server/pagination";

type Params = { params: Promise<{ id: string }> };

/**
 * Toàn bộ tài khoản của một ngân hàng — bảng ở trang chi tiết ngân hàng.
 *
 * Gác bằng `canManageBank`, KHÔNG bằng `banking:view-detail`. Người quản ngân
 * hàng thường chỉ có phạm vi phòng mình ở màn P-21; ở đây họ phải thấy đủ mọi
 * tài khoản của ngân hàng được giao. Đổi lại, ai không quản ngân hàng này thì
 * không vào được, kể cả người đọc P-21 toàn công ty.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const url = new URL(request.url);
  const query = url.searchParams;

  return Response.json(
    await listBankAccountsOfBank(
      id,
      {
        from: query.get("from") ?? "",
        to: query.get("to") ?? "",
        status: query.get("status") ?? "",
        // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500.
        referralCodeId: uuidParam(query.get("referralCodeId")),
        departmentId: uuidParam(query.get("departmentId")),
        accountType: query.get("accountType") ?? "",
      },
      pageArgsFrom(url, BANK_ACCOUNT_SORT, "date"),
    ),
  );
}

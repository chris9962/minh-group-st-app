import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized, uuidParam } from "@/server/auth";
import { listBankAccountsOfBankForExport } from "@/server/banking";

type Params = { params: Promise<{ id: string }> };

/**
 * Trọn danh sách tài khoản của một ngân hàng, cho nút Xuất Excel.
 *
 * Gác giống route phân trang cạnh nó: `canManageBank`, không phải
 * `banking:export`. Bảng ở màn đó đã mở toàn bộ tài khoản của ngân hàng cho
 * người quản, nên chặn riêng lượt xuất chỉ chặn được thao tác chép tay.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const query = new URL(request.url).searchParams;

  return Response.json(
    await listBankAccountsOfBankForExport(id, {
      from: query.get("from") ?? "",
      to: query.get("to") ?? "",
      status: query.get("status") ?? "",
      referralCodeId: uuidParam(query.get("referralCodeId")),
      departmentId: uuidParam(query.get("departmentId")),
      accountType: query.get("accountType") ?? "",
    }),
  );
}

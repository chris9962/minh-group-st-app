import { BANK_ACCOUNT_SORT } from "@/lib/api/banking";
import { BANK_PHOTOS_PAGE_SIZE } from "@/lib/api/bankPhotos";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized, uuidParam } from "@/server/auth";
import { listBankPhotos } from "@/server/banking";
import { pageArgsFrom } from "@/server/pagination";

type Params = { params: Promise<{ id: string }> };

/**
 * Tab Ảnh của trang chi tiết ngân hàng — cùng chốt phân quyền với route
 * `/accounts` bên cạnh: `canManageBank`, không kẹp phạm vi phòng.
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
    await listBankPhotos(
      id,
      {
        from: query.get("from") ?? "",
        to: query.get("to") ?? "",
        status: query.get("status") ?? "",
        // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500.
        referralCodeId: uuidParam(query.get("referralCodeId")),
        departmentId: uuidParam(query.get("departmentId")),
      },
      pageArgsFrom(url, BANK_ACCOUNT_SORT, "date", BANK_PHOTOS_PAGE_SIZE),
    ),
  );
}

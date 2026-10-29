import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { personAccountsByBankFor } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

/** P-52 · Số tài khoản theo ngân hàng của tab Tài khoản, cùng kỳ với danh sách. */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || from > to)
    return badRequest("Khoảng ngày không hợp lệ");

  const rows = await personAccountsByBankFor(actor, id, { from, to });
  return rows ? Response.json(rows) : notFound();
}

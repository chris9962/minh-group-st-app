import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { personServicesFor } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

/** P-52 · Một tab hoạt động của một người — phân trang ở máy chủ, kỳ là khoảng ngày tường minh. */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  // Chuỗi ngày bậy đi thẳng vào phép so của SQL là lỗi cast 500 — chặn thành 400.
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || from > to)
    return badRequest("Khoảng ngày không hợp lệ");

  // Ngoài tầm nhìn trả 404, không phải 403 — 403 xác nhận id có thật.
  const page = await personServicesFor(actor, id, { from, to }, pageArgsFrom(url, ["date"], "date"));
  return page ? Response.json(page) : notFound();
}

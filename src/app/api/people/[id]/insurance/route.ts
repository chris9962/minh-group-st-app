import { can } from "@/lib/permissions";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { isPeriod, personInsuranceFor } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

/** P-52 · Một tab hoạt động của một người — phân trang ở máy chủ. */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "today";
  if (!isPeriod(period)) return badRequest("Kỳ xem không hợp lệ");

  // Ngoài tầm nhìn trả 404, không phải 403 — 403 xác nhận id có thật.
  const page = await personInsuranceFor(actor, id, period, pageArgsFrom(url, ["date"], "date"));
  return page ? Response.json(page) : notFound();
}

import { can } from "@/lib/permissions";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { isPeriod, isYearMonth, personFor } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const search = new URL(request.url).searchParams;
  const period = search.get("period") ?? "today";
  const summaryMonth = search.get("summaryMonth") ?? "";
  if (!isPeriod(period)) return badRequest("Kỳ xem không hợp lệ");
  if (summaryMonth && !isYearMonth(summaryMonth)) return badRequest("Tháng không hợp lệ");

  // Ngoài tầm nhìn `personFor` cũng trả null → 404, không phải 403: 403 là xác
  // nhận id có thật, đủ để dò ra danh sách người trong công ty.
  const person = await personFor(actor, id, { period, summaryMonth });
  return person ? Response.json(person) : notFound();
}

import { getActor, unauthorized } from "@/server/auth";
import { personFor } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const person = await personFor(id, {
    period: search.get("period") ?? "today",
    summaryMonth: search.get("summaryMonth") ?? "",
  });
  return person ? Response.json(person) : new Response(null, { status: 404 });
}

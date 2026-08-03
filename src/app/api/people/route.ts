import { getActor, unauthorized } from "@/server/auth";
import { peopleFor } from "@/server/people";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const params = new URL(request.url).searchParams;
  return Response.json(
    await peopleFor(actor, {
      scope: params.get("scope") ?? "",
      period: params.get("period") ?? "today",
      summaryMonth: params.get("summaryMonth") ?? "",
      departmentId: params.get("departmentId") ?? "",
      search: params.get("search") ?? "",
    }),
  );
}

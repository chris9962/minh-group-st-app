import { actorWith } from "@/server/auth";
import { socialInsuranceOptions } from "@/server/socialInsurance";

export async function GET(request: Request) {
  const guard = await actorWith(request, "social-insurance", "view-detail");
  if (!guard.ok) return guard.response;
  return Response.json(await socialInsuranceOptions(guard.actor));
}

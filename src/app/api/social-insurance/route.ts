import { SOCIAL_INSURANCE_SORT } from "@/lib/api/socialInsurance";
import { actorWith } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { listSocialInsurance, socialInsuranceFiltersFrom } from "@/server/socialInsurance";

export async function GET(request: Request) {
  const guard = await actorWith(request, "social-insurance", "view-detail");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  return Response.json(
    await listSocialInsurance(
      guard.actor,
      socialInsuranceFiltersFrom(url.searchParams),
      pageArgsFrom(url, SOCIAL_INSURANCE_SORT, "createdAt"),
    ),
  );
}

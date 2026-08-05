import { actorWith } from "@/server/auth";
import { listReferenceWards } from "@/server/catalog";

/** Xã/phường của một tỉnh. Không truyền tỉnh thì trả cả 3.321 dòng — nặng, nên FE luôn truyền. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const provinceId = new URL(request.url).searchParams.get("provinceId") ?? "";
  return Response.json(await listReferenceWards(provinceId));
}

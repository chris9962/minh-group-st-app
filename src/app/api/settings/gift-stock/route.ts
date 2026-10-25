import { actorWith, badRequest } from "@/server/auth";
import { giftStockMonth } from "@/server/giftStock";

/** P-87 · Kho quà của một tháng. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest();
  return Response.json(await giftStockMonth(month));
}

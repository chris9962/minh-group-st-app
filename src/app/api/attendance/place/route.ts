import { canCheckIn } from "@/server/attendance";
import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { placeName } from "@/server/placeName";

/** Màn chụp hiện tên xã, tỉnh của vị trí đang đứng trước khi bấm Chấm công. */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canCheckIn(actor)) return forbidden();

  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lng"));
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return badRequest();
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return badRequest();

  return Response.json({ place: await placeName(latitude, longitude) });
}

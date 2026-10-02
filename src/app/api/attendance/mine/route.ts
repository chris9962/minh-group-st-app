import { businessMonth } from "@/lib/format";
import { canCheckIn, myAttendance } from "@/server/attendance";
import { forbidden, getActor, unauthorized } from "@/server/auth";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canCheckIn(actor)) return forbidden();

  const month = new URL(request.url).searchParams.get("month") ?? "";
  return Response.json(await myAttendance(actor, /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : businessMonth()));
}

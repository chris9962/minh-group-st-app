import { AttendanceForm, slotLabel } from "@/lib/api/attendance";
import { businessDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { attendanceDay, canCheckIn, createAttendanceCheck } from "@/server/attendance";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "attendance", "view-detail")) return forbidden();

  const date = new URL(request.url).searchParams.get("date") ?? "";
  return Response.json(await attendanceDay(actor, isRealIsoDate(date) ? date : businessDay()));
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canCheckIn(actor)) return forbidden();

  const parsed = AttendanceForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createAttendanceCheck(actor, parsed.data);
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "attendance",
    action: "create",
    targetLabel: `Chấm công ${slotLabel(result.check.slot)}`,
    targetTable: "attendance_checks",
    targetId: result.check.id,
  });
  return Response.json(result.check, { status: 201 });
}

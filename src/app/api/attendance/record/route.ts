import { RecordAttendanceForm } from "@/lib/api/attendance";
import { recordAttendance } from "@/server/attendance";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";

/** Ghi công thay nhân viên ở bảng chấm công (chốt 2026-10-30). */
export async function POST(request: Request) {
  const guard = await actorWith(request, "attendance", "record-attendance");
  if (!guard.ok) return guard.response;

  const parsed = RecordAttendanceForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const result = await recordAttendance(guard.actor, parsed.data);
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(guard.actor, {
    module: "attendance",
    action: "record-attendance",
    targetLabel: `Ghi công ngày ${parsed.data.workDate} cho ${result.fullName}`,
    targetTable: "attendance_checks",
    targetId: parsed.data.userId,
  });
  return Response.json(result.checks, { status: 201 });
}

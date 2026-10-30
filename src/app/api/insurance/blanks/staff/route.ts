import { StaffBlanksForm } from "@/lib/api/insuranceBlanks";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, uuidParam } from "@/server/auth";
import { departmentName, saveStaffBlanks, staffBlanks } from "@/server/insuranceBlanks";

const paramsFrom = (request: Request) => {
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  return {
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    departmentId: uuidParam(params.get("departmentId")),
  };
};

/** Màn Phát phôi bảo hiểm (chốt 2026-10-29). */
export async function GET(request: Request) {
  const guard = await actorWith(request, "insurance", "split-blanks");
  if (!guard.ok) return guard.response;
  const { month, departmentId } = paramsFrom(request);
  if (!month) return badRequest();

  const result = await staffBlanks(guard.actor, month, departmentId);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json(result.data);
}

export async function PUT(request: Request) {
  const guard = await actorWith(request, "insurance", "split-blanks");
  if (!guard.ok) return guard.response;
  const { month, departmentId } = paramsFrom(request);
  if (!month || !departmentId) return badRequest();

  const parsed = StaffBlanksForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const saved = await saveStaffBlanks(guard.actor, month, departmentId, parsed.data);
  if (!saved.ok) return Response.json({ message: saved.message }, { status: 409 });

  await logAudit(guard.actor, {
    module: "insurance",
    action: "split-blanks",
    targetLabel: `Nhập phôi bảo hiểm tháng ${month} cho ${await departmentName(departmentId)}`,
    targetTable: "insurance_blank_staff_quotas",
    targetId: departmentId,
  });
  const result = await staffBlanks(guard.actor, month, departmentId);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json(result.data);
}

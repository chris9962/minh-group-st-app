import { DepartmentBlanksForm } from "@/lib/api/insuranceBlanks";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { departmentBlanks, saveDepartmentBlanks } from "@/server/insuranceBlanks";

const monthFrom = (request: Request): string | null => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
};

/** Màn Cấp phôi bảo hiểm (chốt 2026-10-29). */
export async function GET(request: Request) {
  const guard = await actorWith(request, "insurance", "allocate-blanks");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();
  return Response.json(await departmentBlanks(month));
}

export async function PUT(request: Request) {
  const guard = await actorWith(request, "insurance", "allocate-blanks");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();

  const parsed = DepartmentBlanksForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const saved = await saveDepartmentBlanks(guard.actor, month, parsed.data);
  if (!saved.ok) return Response.json({ message: saved.message }, { status: 409 });

  await logAudit(guard.actor, {
    module: "insurance",
    action: "allocate-blanks",
    targetLabel: `Cấp phôi bảo hiểm tháng ${month}, mục tiêu điện/xe ${parsed.data.target.electricParts}/${parsed.data.target.motorbikeParts}`,
    targetTable: "insurance_blank_department_quotas",
  });
  return Response.json(await departmentBlanks(month));
}

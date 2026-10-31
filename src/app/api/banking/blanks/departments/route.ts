import { BankDepartmentBlanksForm } from "@/lib/api/bankBlanks";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { bankDepartmentBlanks, saveBankDepartmentBlanks } from "@/server/bankBlanks";

const monthFrom = (request: Request): string | null => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
};

/** Màn Cấp phiếu thông tin ngân hàng (chốt 2026-10-31). */
export async function GET(request: Request) {
  const guard = await actorWith(request, "banking", "allocate-blanks");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();
  return Response.json(await bankDepartmentBlanks(month));
}

export async function PUT(request: Request) {
  const guard = await actorWith(request, "banking", "allocate-blanks");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();

  const parsed = BankDepartmentBlanksForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const saved = await saveBankDepartmentBlanks(guard.actor, month, parsed.data);
  if (!saved.ok) return Response.json({ message: saved.message }, { status: 409 });

  await logAudit(guard.actor, {
    module: "banking",
    action: "allocate-blanks",
    targetLabel: `Cấp phiếu thông tin ngân hàng tháng ${month}`,
    targetTable: "bank_blank_department_quotas",
  });
  return Response.json(await bankDepartmentBlanks(month));
}

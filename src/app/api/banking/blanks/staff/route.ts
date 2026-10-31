import { BankStaffBlanksForm } from "@/lib/api/bankBlanks";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, uuidParam } from "@/server/auth";
import { bankStaffBlanks, saveBankStaffBlanks } from "@/server/bankBlanks";
import { departmentName } from "@/server/insuranceBlanks";

const paramsFrom = (request: Request) => {
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  return {
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    departmentId: uuidParam(params.get("departmentId")),
  };
};

/** Màn Phát phiếu thông tin ngân hàng (chốt 2026-10-31). */
export async function GET(request: Request) {
  const guard = await actorWith(request, "banking", "split-blanks");
  if (!guard.ok) return guard.response;
  const { month, departmentId } = paramsFrom(request);
  if (!month) return badRequest();

  const result = await bankStaffBlanks(guard.actor, month, departmentId);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json(result.data);
}

export async function PUT(request: Request) {
  const guard = await actorWith(request, "banking", "split-blanks");
  if (!guard.ok) return guard.response;
  const { month, departmentId } = paramsFrom(request);
  if (!month || !departmentId) return badRequest();

  const parsed = BankStaffBlanksForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const saved = await saveBankStaffBlanks(guard.actor, month, departmentId, parsed.data);
  if (!saved.ok) return Response.json({ message: saved.message }, { status: 409 });

  await logAudit(guard.actor, {
    module: "banking",
    action: "split-blanks",
    targetLabel: `Nhập phiếu thông tin ngân hàng tháng ${month} cho ${await departmentName(departmentId)}`,
    targetTable: "bank_blank_staff_quotas",
    targetId: departmentId,
  });
  const result = await bankStaffBlanks(guard.actor, month, departmentId);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json(result.data);
}

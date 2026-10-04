import { KIND_LABEL, RecordImportRequest } from "@/lib/api/socialInsurance";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { importRecords } from "@/server/socialInsuranceImport";

/** File 1. `commit: false` chỉ trả bảng xem trước. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "social-insurance", "create");
  if (!guard.ok) return guard.response;

  const parsed = RecordImportRequest.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const outcome = await importRecords(guard.actor, parsed.data);
  if (!outcome.ok) return Response.json({ message: outcome.message }, { status: 422 });

  if (parsed.data.commit)
    await logAudit(guard.actor, {
      module: "social-insurance",
      action: "create",
      targetLabel: `Nhập file ${KIND_LABEL[parsed.data.kind]}: ${outcome.result.written} dòng`,
      targetTable: "social_insurance_records",
    });
  return Response.json(outcome.result);
}

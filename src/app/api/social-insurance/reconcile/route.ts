import { KIND_LABEL, ReconcileImportRequest } from "@/lib/api/socialInsurance";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { importReconciliation } from "@/server/socialInsuranceImport";

/** File 2, đối chiếu. `commit: false` chỉ trả bảng xem trước. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "social-insurance", "create");
  if (!guard.ok) return guard.response;

  const parsed = ReconcileImportRequest.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const outcome = await importReconciliation(guard.actor, parsed.data);
  if (!outcome.ok) return Response.json({ message: outcome.message }, { status: 422 });

  if (parsed.data.commit)
    await logAudit(guard.actor, {
      module: "social-insurance",
      action: "update",
      targetLabel: `Đối chiếu ${KIND_LABEL[parsed.data.kind]}: ${outcome.result.written} dòng`,
      targetTable: "social_insurance_records",
    });
  return Response.json(outcome.result);
}

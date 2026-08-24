import { InsurancePackageForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateInsurancePackage } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = InsurancePackageForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateInsurancePackage(id, parsed.data);
  if (!result.ok) return badRequest("Tên gói bảo hiểm này đã có");
  const item = result.item;
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "insurance",
    action: "update",
    targetLabel: `Sửa gói bảo hiểm ${item.name}`,
    targetTable: "insurance_packages",
    targetId: id,
  });
  return Response.json(item);
}

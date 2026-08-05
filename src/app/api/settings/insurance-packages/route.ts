import { InsurancePackageForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createInsurancePackage, listInsurancePackages } from "@/server/catalog";

/** P-82 · Danh mục gói bảo hiểm. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "insurance", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listInsurancePackages());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "insurance", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = InsurancePackageForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await createInsurancePackage(parsed.data);

  await logAudit(guard.actor, {
    module: "insurance",
    action: "create",
    targetLabel: `Thêm gói bảo hiểm ${item.name}`,
    targetTable: "insurance_packages",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}

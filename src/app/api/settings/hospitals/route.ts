import { HospitalForm } from "@/lib/api/hospitalCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createHospital, listHospitals } from "@/server/catalog";

/** P-71 · Danh mục bệnh viện. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listHospitals());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = HospitalForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await createHospital(parsed.data);

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm bệnh viện ${item.name}`,
    targetTable: "hospitals",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}

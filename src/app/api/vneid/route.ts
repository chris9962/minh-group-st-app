import { VNEID_SORT, VneidForm } from "@/lib/api/vneid";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { createVneid, listVneid, vneidFiltersFrom } from "@/server/vneid";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "vneid", "view-detail")) return forbidden();

  const url = new URL(request.url);
  return Response.json(
    await listVneid(actor, vneidFiltersFrom(url.searchParams), pageArgsFrom(url, VNEID_SORT, "createdAt")),
  );
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "vneid", "create")) return forbidden();

  const parsed = VneidForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createVneid(actor, parsed.data);
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "vneid",
    action: "create",
    targetLabel: `VNeID cho ${result.record.customerName}`,
    targetTable: "vneid_records",
    targetId: result.record.id,
  });
  return Response.json(result.record, { status: 201 });
}

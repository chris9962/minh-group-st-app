import { ServiceTypeForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { createServiceType, listServiceTypes } from "@/server/catalog";

/** P-84 · Danh mục loại dịch vụ + hệ số điểm. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "services", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listServiceTypes());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "services", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = ServiceTypeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await createServiceType(parsed.data);

  await logAudit(guard.actor, {
    module: "services",
    action: "create",
    targetLabel: `Thêm loại dịch vụ ${item.name}`,
    targetTable: "service_types",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}

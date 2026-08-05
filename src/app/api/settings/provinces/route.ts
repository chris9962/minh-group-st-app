import { AddProvinceForm } from "@/lib/api/wardCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { addProvince, listProvinceTree } from "@/server/catalog";

/** P-71 · Địa bàn công ty — cây tỉnh · xã/phường · ấp. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listProvinceTree());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = AddProvinceForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const tree = await addProvince(parsed.data.provinceId);

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: "Thêm tỉnh vào địa bàn",
    targetTable: "provinces",
  });
  return Response.json(tree, { status: 201 });
}

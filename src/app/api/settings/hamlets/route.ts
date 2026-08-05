import { HamletForm } from "@/lib/api/wardCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, notFound } from "@/server/auth";
import { addHamlet } from "@/server/catalog";

/** Ấp nhập tay — dữ liệu nhà nước không có cấp này. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = HamletForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const province = await addHamlet(parsed.data.wardId, parsed.data.name);

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm ấp ${parsed.data.name}`,
    targetTable: "hamlets",
  });
  if (!province) return notFound();

  return Response.json(province, { status: 201 });
}

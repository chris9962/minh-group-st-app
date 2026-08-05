import { AddWardForm } from "@/lib/api/wardCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, notFound } from "@/server/auth";
import { addWard } from "@/server/catalog";

/** Trả về CẢ CÂY chứ không riêng xã vừa thêm — màn P-71 vẽ lại từ một nguồn. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = AddWardForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const province = await addWard(parsed.data.provinceId, parsed.data.wardId);

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: "Thêm xã/phường vào địa bàn",
    targetTable: "wards",
  });
  if (!province) return notFound();

  return Response.json(province, { status: 201 });
}

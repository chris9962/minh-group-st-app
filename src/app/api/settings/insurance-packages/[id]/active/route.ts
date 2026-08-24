import { z } from "zod";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { setInsurancePackageActive } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

/** Ngừng / mở lại — KHÔNG xoá. Bản ghi cũ trỏ vào id, xoá là để lại id chết. */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await setInsurancePackageActive(id, parsed.data.active);
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "insurance",
    action: "update",
    targetLabel: `${parsed.data.active ? "Mở lại" : "Ngừng"} gói bảo hiểm ${item.name}`,
    targetTable: "insurance_packages",
    targetId: id,
  });
  return Response.json(item);
}

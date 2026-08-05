import { z } from "zod";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { setServiceTypeActive } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

/** Ngừng / mở lại — KHÔNG xoá. Bản ghi cũ trỏ vào id, xoá là để lại id chết. */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "services", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await setServiceTypeActive(id, parsed.data.active);
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "services",
    action: "update",
    targetLabel: `${parsed.data.active ? "Mở lại" : "Ngừng"} loại dịch vụ ${item.name}`,
    targetTable: "service_types",
    targetId: id,
  });
  return Response.json(item);
}

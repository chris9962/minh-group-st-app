import { z } from "zod";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { setBankActive } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

/** Ngừng / mở lại — KHÔNG xoá. Bản ghi cũ trỏ vào id, xoá là để lại id chết. */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "banking", "manage-bank-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const item = await setBankActive(id, parsed.data.active);
  if (!item) return notFound();

  await logAudit(guard.actor, {
    module: "banking",
    action: "update",
    targetLabel: `${parsed.data.active ? "Mở lại" : "Ngừng"} ngân hàng ${item.code}`,
    targetTable: "banks",
    targetId: id,
  });
  return Response.json(item);
}
